#!/usr/bin/env python3
"""Builds the standalone Universal 2 macOS bundle 'Ricochet Infinity.app' and packages it into a single .dmg and .zip file."""

import os
import plistlib
import shutil
import subprocess
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
APP_BUNDLE = ROOT / 'Ricochet Infinity.app'
CONTENTS = APP_BUNDLE / 'Contents'
MACOS_DIR = CONTENTS / 'MacOS'
RESOURCES_DIR = CONTENTS / 'Resources'
DIST_DIR = ROOT / 'dist'


def build_icns():
    ico_path = ROOT / 'extracted' / 'game' / 'ReflexiveArcade' / 'Icon_3.ico'
    logo_path = ROOT / 'public' / 'assets' / 'sprites' / 'Resources' / 'Interface' / 'Upsell' / 'RI Logo.png'
    iconset_dir = ROOT / 'macos' / 'AppIcon.iconset'
    if iconset_dir.exists():
        shutil.rmtree(iconset_dir)
    iconset_dir.mkdir(parents=True, exist_ok=True)

    src_img = Image.open(ico_path if ico_path.exists() else logo_path).convert('RGBA')
    sizes = [16, 32, 128, 256, 512]
    for s in sizes:
        im1 = src_img.resize((s, s), Image.Resampling.LANCZOS)
        im1.save(iconset_dir / f'icon_{s}x{s}.png')
        im2 = src_img.resize((s * 2, s * 2), Image.Resampling.LANCZOS)
        im2.save(iconset_dir / f'icon_{s}x{s}@2x.png')

    icns_out = RESOURCES_DIR / 'AppIcon.icns'
    subprocess.run(['iconutil', '-c', 'icns', str(iconset_dir), '-o', str(icns_out)], check=True)
    shutil.rmtree(iconset_dir)


def compile_universal_binary(swift_src: Path, exe_path: Path):
    slices = []
    for arch in ('arm64', 'x86_64'):
        slice_path = ROOT / 'macos' / f'RicochetInfinity_{arch}'
        slices.append(slice_path)
        subprocess.run(
            [
                'swiftc',
                '-O',
                '-target',
                f'{arch}-apple-macosx11.0',
                str(swift_src),
                '-framework',
                'Cocoa',
                '-framework',
                'WebKit',
                '-o',
                str(slice_path),
            ],
            check=True,
        )
    try:
        subprocess.run(
            ['lipo', '-create', *map(str, slices), '-output', str(exe_path)],
            check=True,
        )
    finally:
        for slice_path in slices:
            slice_path.unlink(missing_ok=True)


def package_single_files():
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    dmg_path = DIST_DIR / 'Ricochet-Infinity-macOS.dmg'
    zip_path = DIST_DIR / 'Ricochet-Infinity-macOS.zip'
    dmg_staging = DIST_DIR / 'dmg_staging'

    if dmg_staging.exists():
        shutil.rmtree(dmg_staging)
    dmg_staging.mkdir(parents=True, exist_ok=True)

    # Copy self-contained .app and create /Applications drag-and-drop link
    shutil.copytree(APP_BUNDLE, dmg_staging / 'Ricochet Infinity.app', symlinks=True)
    os.symlink('/Applications', dmg_staging / 'Applications')

    if dmg_path.exists():
        dmg_path.unlink()
    subprocess.run(
        [
            'hdiutil',
            'create',
            '-volname',
            'Ricochet Infinity',
            '-srcfolder',
            str(dmg_staging),
            '-ov',
            '-format',
            'UDZO',
            '-imagekey',
            'zlib-level=9',
            str(dmg_path),
        ],
        check=True,
    )
    shutil.rmtree(dmg_staging)

    if zip_path.exists():
        zip_path.unlink()
    subprocess.run(
        [
            'ditto',
            '-c',
            '-k',
            '--sequesterRsrc',
            '--keepParent',
            str(APP_BUNDLE),
            str(zip_path),
        ],
        check=True,
    )
    print(f'Single-file DMG created: {dmg_path} ({dmg_path.stat().st_size / 1e6:.2f} MB)')
    print(f'Single-file ZIP created: {zip_path} ({zip_path.stat().st_size / 1e6:.2f} MB)')


def main():
    # Fail early with a clear message instead of a mid-build traceback.
    if not (ROOT / 'public' / 'index.html').exists():
        raise SystemExit(f'Missing {ROOT / "public" / "index.html"}; nothing to bundle.')
    if APP_BUNDLE.exists():
        shutil.rmtree(APP_BUNDLE)
    MACOS_DIR.mkdir(parents=True, exist_ok=True)
    RESOURCES_DIR.mkdir(parents=True, exist_ok=True)

    exe_path = MACOS_DIR / 'RicochetInfinity'
    swift_src = ROOT / 'macos' / 'main.swift'
    compile_universal_binary(swift_src, exe_path)

    build_icns()

    # Embed all compiled assets inside Ricochet Infinity.app/Contents/Resources/public
    shutil.copytree(
        ROOT / 'public', RESOURCES_DIR / 'public', ignore=shutil.ignore_patterns('.DS_Store', '__pycache__')
    )

    info = {
        'CFBundleName': 'Ricochet Infinity',
        'CFBundleDisplayName': 'Ricochet Infinity',
        'CFBundleIdentifier': 'com.reflexive.ricochetinfinity.macos',
        'CFBundleInfoDictionaryVersion': '6.0',
        'CFBundleVersion': '3.0.73',
        'CFBundleShortVersionString': '3.0.73',
        'CFBundlePackageType': 'APPL',
        'CFBundleExecutable': 'RicochetInfinity',
        'CFBundleIconFile': 'AppIcon',
        'LSMinimumSystemVersion': '11.0',
        'LSApplicationCategoryType': 'public.app-category.arcade-games',
        'NSHighResolutionCapable': True,
        'NSPrincipalClass': 'NSApplication',
    }
    with open(CONTENTS / 'Info.plist', 'wb') as f:
        plistlib.dump(info, f)

    # Ad-hoc sign the universal app bundle so macOS Gatekeeper / Apple Silicon allows execution cleanly
    subprocess.run(['codesign', '--force', '--deep', '--sign', '-', str(APP_BUNDLE)], check=True)

    print(f'Successfully built self-contained Universal 2 macOS application: {APP_BUNDLE}')
    package_single_files()


if __name__ == '__main__':
    main()
