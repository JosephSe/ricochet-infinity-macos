#!/usr/bin/env python3
"""
Ricochet Infinity — Retail Asset & Level Compiler for macOS Port.
Decodes all proprietary .Frame / .Sequence binary textures (Mode 0 JPEG+DeltaAlpha
and Mode 1 4-plane DeltaRGBA), parses Reflexive serialized C++ object trees
(.RicochetI, .Ricochet, .BrickStyleSheet, .PowerUp, .Background, .PGen, .Quest.txt),
and outputs web/macOS-ready PNGs + JSON manifests.
"""

import io
import json
import os
import re
import shutil
import struct
import sys
import zlib
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

ROOT = Path("/Users/josephwork/Documents/antigravity/dazzling-euclid")
EXTRACTED_ASSETS = ROOT / "extracted" / "assets"
EXTRACTED_GAME = ROOT / "extracted" / "game"
OUT_DIR = ROOT / "public" / "assets"


def parse_reflexive_object_text(text: str) -> dict[str, Any]:
    """
    Parses Reflexive Entertainment's hierarchical serialized C++ object text format:
    ClassName
    {
        Key=Value
        ChildObj=SubClassName
        {
            ...
        }
    }
    Returns a nested Python dictionary.
    """
    lines = [line.strip() for line in text.replace("\r\n", "\n").split("\n")]
    n = len(lines)
    idx = 0

    def parse_block(class_name: str) -> dict[str, Any]:
        nonlocal idx
        obj: dict[str, Any] = {"__class__": class_name}
        items_list: list[Any] = []
        while idx < n:
            line = lines[idx]
            idx += 1
            if not line or line.startswith("//"):
                continue
            if line == "{":
                continue
            if line == "}":
                break
            if "=" in line:
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip()
                # Check if next non-empty line is "{"
                peek = idx
                while peek < n and (not lines[peek] or lines[peek].startswith("//")):
                    peek += 1
                if peek < n and lines[peek] == "{":
                    idx = peek + 1
                    child = parse_block(val)
                    if key in obj:
                        if not isinstance(obj[key], list):
                            obj[key] = [obj[key]]
                        obj[key].append(child)
                    else:
                        obj[key] = child
                    items_list.append((key, child))
                else:
                    if key in obj:
                        if not isinstance(obj[key], list):
                            obj[key] = [obj[key]]
                        obj[key].append(val)
                    else:
                        obj[key] = val
                    items_list.append((key, val))
            else:
                # Standalone class header followed by '{'
                peek = idx
                while peek < n and (not lines[peek] or lines[peek].startswith("//")):
                    peek += 1
                if peek < n and lines[peek] == "{":
                    idx = peek + 1
                    child = parse_block(line)
                    key = line
                    if key in obj:
                        if not isinstance(obj[key], list):
                            obj[key] = [obj[key]]
                        obj[key].append(child)
                    else:
                        obj[key] = child
        return obj

    root_objs: dict[str, Any] = {}
    while idx < n:
        line = lines[idx]
        idx += 1
        if not line or line.startswith("//"):
            continue
        peek = idx
        while peek < n and (not lines[peek] or lines[peek].startswith("//")):
            peek += 1
        if peek < n and lines[peek] == "{":
            idx = peek + 1
            root_objs[line] = parse_block(line)
    if len(root_objs) == 1:
        return next(iter(root_objs.values()))
    return root_objs


def decode_image_stream(rem: bytes) -> Image.Image | None:
    """
    Decodes CFrame binary pixel stream (Data3.bin @ 0x10151d00..0x10152010):
    - mode 0: 4-byte offset, RGB JPEG stream, then zlib stream with delta-encoded 8-bit alpha
    - mode 1: 1-byte submode, 4-byte csize, 4-byte usize, zlib stream of 4 planar delta-encoded R,G,B,A channels, followed by width, height
    """
    if not rem:
        return None
    mode = rem[0]
    if mode == 0:
        off = struct.unpack_from("<I", rem, 1)[0]
        jpg_bytes = rem[5 : 1 + off]
        img = Image.open(io.BytesIO(jpg_bytes)).convert("RGB")
        w, h = img.size
        rgb = np.array(img, dtype=np.uint8)
        after = rem[1 + off :]
        csize, usize = struct.unpack_from("<II", after, 1)
        alpha_delta = np.frombuffer(zlib.decompress(after[9 : 9 + csize]), dtype=np.uint8)
        alpha = np.cumsum(alpha_delta, dtype=np.uint64).astype(np.uint8).reshape((h, w, 1))
        rgba = np.concatenate([rgb, alpha], axis=2)
        return Image.fromarray(rgba, "RGBA")
    elif mode == 1:
        subm, csize, usize = struct.unpack_from("<BII", rem, 1)
        raw = np.frombuffer(zlib.decompress(rem[10 : 10 + csize]), dtype=np.uint8)
        w, h = struct.unpack_from("<II", rem, 10 + csize)
        n = w * h
        planes = raw.reshape((4, n))
        decoded = np.cumsum(planes, axis=1, dtype=np.uint64).astype(np.uint8)
        rgba = np.stack([decoded[0], decoded[1], decoded[2], decoded[3]], axis=-1).reshape((h, w, 4))
        return Image.fromarray(rgba, "RGBA")
    return None


def build_sprites() -> dict[str, Any]:
    cache_root = EXTRACTED_ASSETS / "Cache"
    sprites_out = OUT_DIR / "sprites"
    sprites_out.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, Any] = {}
    count = 0

    for dp, _, fs in sorted(os.walk(cache_root)):
        for fn in sorted(fs):
            ext = os.path.splitext(fn)[1].lower()
            if ext not in (".frame", ".sequence"):
                continue
            full_path = Path(dp) / fn
            rel_cache = full_path.relative_to(cache_root).as_posix()
            # Logical key used by game scripts: strip leading "Resources/" and extension
            logical_key = rel_cache
            if logical_key.startswith("Resources/"):
                logical_key = logical_key[len("Resources/") :]
            logical_key_no_ext = os.path.splitext(logical_key)[0]

            with open(full_path, "rb") as f:
                b = f.read()

            entry: dict[str, Any] = {
                "type": "sequence" if ext == ".sequence" else "frame",
                "key": logical_key_no_ext,
            }

            if ext == ".sequence":
                ver, csize, usize = struct.unpack_from("<BII", b, 0)
                meta_txt = zlib.decompress(b[9 : 9 + csize]).decode("latin1", errors="replace")
                meta_obj = parse_reflexive_object_text(meta_txt)
                rem = b[9 + csize :]

                seq_part = meta_obj.get("CSequence", {})
                info_part = meta_obj.get("CSequenceFrameInfoList", {})
                entry["fps"] = float(info_part.get("FPS", seq_part.get("Frames Per Second", 15)))
                entry["blitType"] = seq_part.get("Blit Type", "Transparent Mask")
                entry["centerHotSpot"] = int(seq_part.get("Center Hot Spot", 1))
                entry["blendedWithBlack"] = int(seq_part.get("Blended With Black", 0))

                frames_raw = info_part.get("Frame Infos", {}).get("Frame Info", [])
                if isinstance(frames_raw, dict):
                    frames_raw = [frames_raw]
                frames = []
                for fr in frames_raw:
                    if not isinstance(fr, dict):
                        continue
                    l = int(fr.get("Left", 0))
                    t = int(fr.get("Top", 0))
                    r = int(fr.get("Right", 0))
                    bot = int(fr.get("Bottom", 0))
                    ox = int(fr.get("UpperLeftXOffset", 0))
                    oy = int(fr.get("UpperLeftYOffset", 0))
                    frames.append({
                        "x": l,
                        "y": t,
                        "w": r - l,
                        "h": bot - t,
                        "ox": ox,
                        "oy": oy,
                    })
                entry["frames"] = frames
            else:
                hx, hy = struct.unpack_from("<ii", b, 0)
                rem = b[8:]
                entry["hotspot"] = [hx, hy]

            img = None
            png_rel = os.path.splitext(rel_cache)[0] + ".png"
            png_path = sprites_out / png_rel
            if png_path.exists():
                with Image.open(png_path) as existing_im:
                    w, h = existing_im.size
                entry["url"] = f"assets/sprites/{png_rel}"
                entry["sheetW"] = w
                entry["sheetH"] = h
                if ext == ".frame":
                    entry["frames"] = [{
                        "x": 0,
                        "y": 0,
                        "w": w,
                        "h": h,
                        "ox": -w // 2,
                        "oy": -h // 2,
                    }]
            else:
                img = decode_image_stream(rem)
                if img is not None:
                    png_path.parent.mkdir(parents=True, exist_ok=True)
                    img.save(png_path, "PNG", compress_level=1)
                    w, h = img.size
                    entry["url"] = f"assets/sprites/{png_rel}"
                    entry["sheetW"] = w
                    entry["sheetH"] = h
                    if ext == ".frame":
                        entry["frames"] = [{
                            "x": 0,
                            "y": 0,
                            "w": w,
                            "h": h,
                            "ox": -w // 2,
                            "oy": -h // 2,
                        }]
                else:
                    entry["url"] = None
                    entry["sheetW"] = 0
                    entry["sheetH"] = 0
                    entry["frames"] = []

            manifest[logical_key_no_ext] = entry
            manifest[logical_key_no_ext.lower()] = entry
            count += 1

    print(f"[build_assets] Processed {count} .Frame/.Sequence sprites.")
    return manifest


def parse_polygon(poly_str: str) -> list[list[float]]:
    if not poly_str:
        return []
    nums = [float(x.strip()) for x in poly_str.split(",") if x.strip()]
    pts = []
    for i in range(0, len(nums) - 1, 2):
        pts.append([nums[i], nums[i + 1]])
    return pts


def build_brick_styles() -> dict[str, Any]:
    styles_root = EXTRACTED_ASSETS / "Resources" / "Brick Style Sheets"
    styles: dict[str, Any] = {}
    for dp, _, fs in sorted(os.walk(styles_root)):
        for fn in sorted(fs):
            if not fn.lower().endswith(".brickstylesheet"):
                continue
            p = Path(dp) / fn
            rel = p.relative_to(styles_root).as_posix()
            key = os.path.splitext(rel)[0]
            with open(p, "rb") as f:
                txt = f.read().decode("latin1", errors="replace")
            obj = parse_reflexive_object_text(txt)
            seq = obj.get("Primary Sequence", "")
            if not seq or seq == "!None":
                seq = (
                    obj.get("Idle Sequence")
                    or obj.get("Editor Sequence")
                    or obj.get("Editor Button Sequence")
                    or ""
                )
            hit_imgs_raw = obj.get("Hit Image", {})
            hit_imgs = hit_imgs_raw.get("Hit Image", []) if isinstance(hit_imgs_raw, dict) else []
            if isinstance(hit_imgs, str):
                hit_imgs = [hit_imgs]
            item = {
                "key": key,
                "class": obj.get("__class__", "CBrickStyleSheetNormal"),
                "name": obj.get("Name", ""),
                "score": int(float(obj.get("Score", 10) or 10)),
                "sequence": seq,
                "switchingSequence": obj.get("Switching Sequence", ""),
                "hitImages": hit_imgs,
                "destroyedSeq": obj.get("Destroyed Seq", obj.get("Destroyed Sequence", "")),
                "destroyedSound": obj.get("Destroyed Sound", "Pop Brick"),
                "damagedSound": obj.get("Damaged Sound", "Damage"),
                "indestructibleSound": obj.get("Indestructible Sound", "Indestructible"),
                "pickupSound": obj.get("Pickup Sound", "Get Coin"),
                "pickupSeq": obj.get("Pickup Seq", "Effects/Ring Pickup"),
                "explosionX": float(obj.get("Explosion X Radius", 80) or 80),
                "explosionY": float(obj.get("Explosion Y Radius", 80) or 80),
                "explosionDelay": float(obj.get("Explosion Delay", 0.2) or 0.2),
                "collisionPoly": parse_polygon(obj.get("Collision Poly", "")),
                "gridPoly": parse_polygon(obj.get("Grid Polygon", "")),
                "defaultTint": obj.get("Default Tint", "255,255,255"),
                "raw": obj,
            }
            styles[key] = item
            styles[key.lower()] = item
    print(f"[build_assets] Parsed {len(styles)//2} .BrickStyleSheet definitions.")
    return styles


def build_backgrounds() -> dict[str, Any]:
    env_root = EXTRACTED_ASSETS / "Resources" / "Environments"
    bgs: dict[str, Any] = {}
    for dp, _, fs in sorted(os.walk(env_root)):
        for fn in sorted(fs):
            if not fn.lower().endswith(".background"):
                continue
            p = Path(dp) / fn
            rel = p.relative_to(EXTRACTED_ASSETS / "Resources").as_posix()
            key = os.path.splitext(rel)[0]
            with open(p, "rb") as f:
                txt = f.read().decode("latin1", errors="replace")
            obj = parse_reflexive_object_text(txt)
            music = obj.get("Music Tracks", {})
            bgs[key] = {
                "key": key,
                "backgroundImage": obj.get("Background Image", ""),
                "midgroundImage": obj.get("Midground Image", ""),
                "foregroundImage": obj.get("Foreground Image", ""),
                "music": music.get("Full Mix Song", "") if isinstance(music, dict) else "",
                "ambient": music.get("Ambient Song", "") if isinstance(music, dict) else "",
                "shadowOffset": obj.get("Shadow Offset", "10,10"),
                "spriteGenerators": obj.get("Sprite Generators", {}),
                "exampleBrick": obj.get("Example Brick Sequence", ""),
            }
            bgs[key.lower()] = bgs[key]
    print(f"[build_assets] Parsed {len(bgs)//2} .Background definitions.")
    return bgs


def build_powerups() -> dict[str, Any]:
    pu_root = EXTRACTED_ASSETS / "Resources" / "Power Ups"
    powerups: dict[str, Any] = {}
    for dp, _, fs in sorted(os.walk(pu_root)):
        for fn in sorted(fs):
            if not fn.lower().endswith(".powerup"):
                continue
            p = Path(dp) / fn
            key = os.path.splitext(fn)[0]
            with open(p, "rb") as f:
                txt = f.read().decode("latin1", errors="replace")
            obj = parse_reflexive_object_text(txt)
            item = {
                "key": key,
                "class": obj.get("__class__", ""),
                "name": obj.get("Name", key),
                "specialtyName": obj.get("Specialty Name", ""),
                "description": obj.get("Description", ""),
                "sequence": obj.get("Primary Sequence", f"Power Ups/{key}"),
                "sound": obj.get("Activation Sound", ""),
                "karma": obj.get("Karma Type", "Good Effect"),
                "score": int(float(obj.get("Collection Score", 200) or 200)),
                "dropSpeed": float(obj.get("Drop Speed", 100) or 100),
                "weight": float(obj.get("Occurrence Frequency Weighting", 1) or 1),
                "cheat": obj.get("Cheat Code", ""),
                "raw": obj,
            }
            powerups[key] = item
            powerups[key.lower()] = item
    print(f"[build_assets] Parsed {len(powerups)//2} .PowerUp definitions.")
    return powerups


def build_ships() -> list[dict[str, Any]]:
    ship_root = EXTRACTED_ASSETS / "Resources" / "Player Ship" / "Selectable Player Ships"
    ships = []
    for fn in sorted(os.listdir(ship_root)):
        if not fn.endswith(".PlayerShipStyleSheet.txt"):
            continue
        key = fn.replace(".PlayerShipStyleSheet.txt", "")
        with open(ship_root / fn, "rb") as f:
            txt = f.read().decode("latin1", errors="replace")
        obj = parse_reflexive_object_text(txt)
        specs = obj.get("Ship Specialty Power-Ups", {}).get("Ship Specialty Power-Up", [])
        if isinstance(specs, str):
            specs = [specs]
        ships.append({
            "key": key,
            "name": key.replace(" Player Ship", ""),
            "sequence": obj.get("Ship Sequence", f"Player Ship/Selectable Player Ships/{key}"),
            "bigSequence": f"Player Ship/Main Menu Ships/Big {key}",
            "iconSequence": f"Player Ship/Main Menu Ships/Icon {key}",
            "largerEngines": int(obj.get("Ship Has Larger Engines", 0) or 0),
            "specialties": specs,
            "description": obj.get("Ship Specialty Description", ""),
        })
    print(f"[build_assets] Parsed {len(ships)} selectable player ships.")
    return ships


def parse_round_brick(b_obj: dict[str, Any], idx: int) -> dict[str, Any]:
    b_class = b_obj.get("__class__", "CBrickNormal")
    pos_str = b_obj.get("Brick Position", "0,0")
    px, py = [float(x.strip()) for x in pos_str.split(",")[:2]] if "," in pos_str else (0.0, 0.0)
    tint_str = b_obj.get("Tint", "255,255,255")
    tint = [int(x.strip()) for x in tint_str.split(",")[:3]] if "," in tint_str else [255, 255, 255]
    return {
        "id": int(b_obj.get("Brick ID", idx)),
        "class": b_class,
        "name": b_obj.get("Name", ""),
        "x": px,
        "y": py,
        "style": b_obj.get("Style Sheet", ""),
        "scaleX": float(b_obj.get("Scale X", 1.0) or 1.0),
        "scaleY": float(b_obj.get("Scale Y", 1.0) or 1.0),
        "rotate": float(b_obj.get("Rotate", 0.0) or 0.0),
        "tint": tint,
        "plugins": b_obj.get("PlugIns", None),
        "extra": {
            k: v
            for k, v in b_obj.items()
            if k not in ("__class__", "Brick Position", "Style Sheet", "Scale X", "Scale Y", "Rotate", "Tint", "PlugIns", "Name")
        },
    }


def build_quests_and_levels() -> dict[str, Any]:
    rounds_root = EXTRACTED_ASSETS / "Resources" / "Rounds"
    levels_out = OUT_DIR / "data" / "levels"
    levels_out.mkdir(parents=True, exist_ok=True)

    # Parse Quest files
    quests = []
    for qfn in ["Ricochet Infinity.Quest.txt", "Episode 2.Quest.txt", "Other Adventures.Quest.txt"]:
        qp = rounds_root / qfn
        if not qp.exists():
            continue
        with open(qp, "rb") as f:
            txt = f.read().decode("latin1", errors="replace")
        obj = parse_reflexive_object_text(txt)
        planets_raw = obj.get("Planets", {}).get("Planet", [])
        if isinstance(planets_raw, dict):
            planets_raw = [planets_raw]
        planets = []
        for pl in planets_raw:
            rset = pl.get("Round Set", "")
            slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", rset).strip("_").lower()
            envs = pl.get("Environments", {}).get("Environment", [])
            if isinstance(envs, str):
                envs = [envs]
            planets.append({
                "name": pl.get("Display Name", ""),
                "description": pl.get("Description", ""),
                "roundSet": rset,
                "slug": slug,
                "difficulty": int(pl.get("Difficulty", 1) or 1),
                "smallImage": pl.get("Small Planet Image", ""),
                "medImage": pl.get("Medium Planet Image", ""),
                "largeImage": pl.get("Large Planet Image", ""),
                "environments": envs,
            })
        quests.append({
            "file": qfn,
            "questId": int(obj.get("Quest ID", 0) or 0),
            "description": obj.get("Description", ""),
            "image": obj.get("Quest Image", ""),
            "planets": planets,
        })

    # Parse all .RicochetI and .Ricochet level packs
    packs = []
    all_level_files: list[tuple[str, Path]] = []
    for dp, _, fs in sorted(os.walk(rounds_root)):
        for fn in sorted(fs):
            if fn.lower().endswith((".ricocheti", ".ricochet")):
                p = Path(dp) / fn
                rel = "Rounds/" + p.relative_to(rounds_root).as_posix()
                rel_no_ext = os.path.splitext(rel)[0]
                all_level_files.append((rel_no_ext, p))

    ex_path = EXTRACTED_GAME / "Rounds" / "Examples.RicochetI"
    if ex_path.exists():
        all_level_files.append(("Rounds/Examples", ex_path))

    for rel_no_ext, p in all_level_files:
        slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", rel_no_ext).strip("_").lower()
        with open(p, "rb") as f:
            txt = f.read().decode("latin1", errors="replace")
        obj = parse_reflexive_object_text(txt)
        if obj.get("__class__") == "CBrickLayout":
            rounds_raw = [obj]
            author = obj.get("Author", "Reflexive")
            desc = obj.get("Note 1", "")
        else:
            rounds_raw = obj.get("Round List", {}).get("Round", [])
            if isinstance(rounds_raw, dict):
                rounds_raw = [rounds_raw]
            author = obj.get("Author", "Reflexive")
            desc = obj.get("Description", "")

        parsed_rounds = []
        for r_idx, r_obj in enumerate(rounds_raw):
            if not isinstance(r_obj, dict):
                continue
            bricks_raw = r_obj.get("Bricks", {}).get("Brick", [])
            if isinstance(bricks_raw, dict):
                bricks_raw = [bricks_raw]
            bricks = [parse_round_brick(b, b_i) for b_i, b in enumerate(bricks_raw) if isinstance(b, dict)]
            notes = [r_obj.get(f"Note {i}", "") for i in range(1, 6) if r_obj.get(f"Note {i}", "")]
            parsed_rounds.append({
                "index": r_idx,
                "name": r_obj.get("Display Name", f"Round {r_idx + 1}"),
                "author": r_obj.get("Author", author),
                "notes": notes,
                "source": r_obj.get("Source", ""),
                "background": r_obj.get("Background Type", "Environments/Alien Vista/AlienVista"),
                "canvasColor": r_obj.get("Canvas Color", "0,0,0"),
                "blankColor": r_obj.get("Blank Background Color", "0,0,0"),
                "bricks": bricks,
            })

        pack_data = {
            "key": rel_no_ext,
            "slug": slug,
            "name": os.path.splitext(p.name)[0],
            "author": author,
            "description": desc,
            "roundCount": len(parsed_rounds),
            "rounds": parsed_rounds,
        }
        with open(levels_out / f"{slug}.json", "w", encoding="utf-8") as out_f:
            json.dump(pack_data, out_f, separators=(",", ":"))

        packs.append({
            "key": rel_no_ext,
            "slug": slug,
            "name": os.path.splitext(p.name)[0],
            "author": author,
            "description": desc,
            "roundCount": len(parsed_rounds),
            "roundNames": [r["name"] for r in parsed_rounds],
        })

    print(f"[build_assets] Compiled {len(packs)} level packs ({sum(p['roundCount'] for p in packs)} total rounds).")
    return {"quests": quests, "packs": packs}


def copy_audio_and_fonts() -> dict[str, Any]:
    audio_manifest: dict[str, str] = {}
    for folder in ["Music", "Sounds"]:
        src_root = EXTRACTED_ASSETS / folder
        dst_root = OUT_DIR / folder.lower()
        if dst_root.exists():
            shutil.rmtree(dst_root)
        shutil.copytree(src_root, dst_root)
        for dp, _, fs in os.walk(dst_root):
            for fn in fs:
                if fn.lower().endswith((".ogg", ".wav")):
                    rel = (Path(dp) / fn).relative_to(dst_root).as_posix()
                    key = os.path.splitext(rel)[0]
                    audio_manifest[f"{folder}/{key}"] = f"assets/{folder.lower()}/{rel}"
                    audio_manifest[key] = f"assets/{folder.lower()}/{rel}"
                    audio_manifest[key.lower()] = f"assets/{folder.lower()}/{rel}"

    fonts_src = EXTRACTED_ASSETS / "Resources" / "Fonts"
    fonts_dst = OUT_DIR / "fonts"
    fonts_dst.mkdir(parents=True, exist_ok=True)
    for fn in os.listdir(fonts_src):
        if fn.lower().endswith(".ttf"):
            shutil.copy2(fonts_src / fn, fonts_dst / fn)

    print(f"[build_assets] Copied audio ({len(audio_manifest)//3} files) and TTF fonts.")
    return audio_manifest


def main() -> None:
    (OUT_DIR / "data").mkdir(parents=True, exist_ok=True)
    sprites = build_sprites()
    brick_styles = build_brick_styles()
    backgrounds = build_backgrounds()
    powerups = build_powerups()
    ships = build_ships()
    quests_and_packs = build_quests_and_levels()
    audio = copy_audio_and_fonts()

    with open(OUT_DIR / "data" / "sprites.json", "w", encoding="utf-8") as f:
        json.dump(sprites, f, separators=(",", ":"))
    with open(OUT_DIR / "data" / "brick_styles.json", "w", encoding="utf-8") as f:
        json.dump(brick_styles, f, separators=(",", ":"))
    with open(OUT_DIR / "data" / "backgrounds.json", "w", encoding="utf-8") as f:
        json.dump(backgrounds, f, separators=(",", ":"))
    with open(OUT_DIR / "data" / "powerups.json", "w", encoding="utf-8") as f:
        json.dump(powerups, f, separators=(",", ":"))
    with open(OUT_DIR / "data" / "ships.json", "w", encoding="utf-8") as f:
        json.dump(ships, f, separators=(",", ":"))
    with open(OUT_DIR / "data" / "quests.json", "w", encoding="utf-8") as f:
        json.dump(quests_and_packs, f, separators=(",", ":"))
    with open(OUT_DIR / "data" / "audio.json", "w", encoding="utf-8") as f:
        json.dump(audio, f, separators=(",", ":"))

    print("[build_assets] COMPLETE!")


if __name__ == "__main__":
    main()
