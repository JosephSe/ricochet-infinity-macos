import Cocoa
import WebKit

class LocalAssetSchemeHandler: NSObject, WKURLSchemeHandler {
    let publicDir: URL

    init(publicDir: URL) {
        self.publicDir = publicDir
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }

        var relPath = url.path
        if relPath.hasPrefix("/") {
            relPath.removeFirst()
        }
        if relPath.isEmpty {
            relPath = "index.html"
        }

        // url.path is percent-decoded, so "%2e%2e/" would otherwise escape the bundle's public folder.
        let root = publicDir.standardizedFileURL
        let fileURL = root.appendingPathComponent(relPath).standardizedFileURL
        guard fileURL.path.hasPrefix(root.path + "/") else {
            urlSchemeTask.didFailWithError(URLError(.noPermissionsToReadFile))
            return
        }
        guard let fullData = try? Data(contentsOf: fileURL, options: .mappedIfSafe) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let ext = fileURL.pathExtension.lowercased()
        let mimeType: String
        switch ext {
        case "html": mimeType = "text/html; charset=utf-8"
        case "css":  mimeType = "text/css; charset=utf-8"
        case "js":   mimeType = "application/javascript; charset=utf-8"
        case "json": mimeType = "application/json; charset=utf-8"
        case "png":  mimeType = "image/png"
        case "jpg", "jpeg": mimeType = "image/jpeg"
        case "ogg":  mimeType = "audio/ogg"
        case "m4a":  mimeType = "audio/mp4"
        case "mp3":  mimeType = "audio/mpeg"
        case "ttf":  mimeType = "font/ttf"
        default:     mimeType = "application/octet-stream"
        }

        var headers: [String: String] = [
            "Content-Type": mimeType,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache"
        ]

        // <audio> playback in WebKit issues byte-range requests; answer them with 206 Partial Content.
        var data = fullData
        var statusCode = 200
        if let rangeHeader = urlSchemeTask.request.value(forHTTPHeaderField: "Range"),
           let range = LocalAssetSchemeHandler.parseByteRange(rangeHeader, length: fullData.count) {
            data = fullData.subdata(in: range.lowerBound..<(range.upperBound + 1))
            statusCode = 206
            headers["Content-Range"] = "bytes \(range.lowerBound)-\(range.upperBound)/\(fullData.count)"
        }
        headers["Content-Length"] = "\(data.count)"

        if let response = HTTPURLResponse(
            url: url,
            statusCode: statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        ) {
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } else {
            urlSchemeTask.didFailWithError(URLError(.cannotParseResponse))
        }
    }

    /// Parses a single `bytes=start-end` / `bytes=start-` / `bytes=-suffix` range into inclusive byte offsets.
    static func parseByteRange(_ header: String, length: Int) -> ClosedRange<Int>? {
        guard length > 0, header.hasPrefix("bytes=") else { return nil }
        let spec = header.dropFirst("bytes=".count)
        guard !spec.contains(","), let dash = spec.firstIndex(of: "-") else { return nil }
        let startStr = spec[spec.startIndex..<dash]
        let endStr = spec[spec.index(after: dash)...]

        if startStr.isEmpty {
            guard let suffix = Int(endStr), suffix > 0 else { return nil }
            return max(0, length - suffix)...(length - 1)
        }
        guard let start = Int(startStr), start < length else { return nil }
        let end = endStr.isEmpty ? length - 1 : min(Int(endStr) ?? (length - 1), length - 1)
        guard end >= start else { return nil }
        return start...end
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Nothing to cancel for synchronous local reads
    }
}

class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window: NSWindow!
    var webView: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.appearance = NSAppearance(named: .darkAqua)
        buildMainMenu()

        let bundleURL = Bundle.main.bundleURL
        let workspaceDir = bundleURL.deletingLastPathComponent()
        let bundledPublic = Bundle.main.resourceURL?.appendingPathComponent("public")
        let publicDir: URL
        if let bp = bundledPublic, FileManager.default.fileExists(atPath: bp.appendingPathComponent("index.html").path) {
            publicDir = bp
        } else {
            publicDir = workspaceDir.appendingPathComponent("public")
        }

        let rect = NSRect(x: 0, y: 0, width: 1080, height: 780)
        window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Ricochet Infinity — Native macOS Edition"
        window.center()
        window.minSize = NSSize(width: 840, height: 680)
        window.backgroundColor = NSColor(calibratedRed: 0.03, green: 0.05, blue: 0.10, alpha: 1.0)
        window.collectionBehavior = [.fullScreenPrimary]
        window.delegate = self

        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        let schemeHandler = LocalAssetSchemeHandler(publicDir: publicDir)
        config.setURLSchemeHandler(schemeHandler, forURLScheme: "ricochet")

        webView = WKWebView(frame: rect, configuration: config)
        webView.autoresizingMask = [.width, .height]
        if #available(macOS 12.0, *) {
            webView.underPageBackgroundColor = window.backgroundColor
        }
        window.contentView = webView

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        if let startURL = URL(string: "ricochet://app/index.html") {
            webView.load(URLRequest(url: startURL))
        }
    }

    private func buildMainMenu() {
        let appName = "Ricochet Infinity"
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: appName)
        appMenu.addItem(withTitle: "About \(appName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide \(appName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit \(appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        let fullScreen = windowMenu.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.command, .control]
        windowMenu.addItem(.separator())
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu
        mainMenu.addItem(windowItem)

        NSApp.mainMenu = mainMenu
        NSApp.windowsMenu = windowMenu
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
