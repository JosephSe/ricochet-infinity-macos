import Cocoa
import WebKit
import UniformTypeIdentifiers

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

        let fileURL = publicDir.appendingPathComponent(relPath)
        guard let data = try? Data(contentsOf: fileURL) else {
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

        let headers: [String: String] = [
            "Content-Type": mimeType,
            "Content-Length": "\(data.count)",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache"
        ]

        if let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
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

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Nothing to cancel for synchronous local reads
    }
}

class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window: NSWindow!
    var webView: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.appearance = NSAppearance(named: .darkAqua)

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
        webView.setValue(false, forKey: "drawsBackground")
        window.contentView = webView

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        if let startURL = URL(string: "ricochet://app/index.html") {
            webView.load(URLRequest(url: startURL))
        }
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
