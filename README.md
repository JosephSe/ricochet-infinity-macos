# Ricochet Infinity — Native macOS Edition

A native **Universal 2 (`arm64` Apple Silicon + `x86_64` Intel)** macOS port and reverse-engineered runtime for **Ricochet Infinity** (`v3.0.73`, originally developed by Reflexive Entertainment).

---

## 📥 Download & Play on macOS (Single File)

Game lovers can download the **single-file macOS Disk Image (`.dmg`)** or **single-file `.zip`** directly from the [**Releases**](../../releases/latest) page:

1. Download **`Ricochet-Infinity-macOS.dmg`** (or **`Ricochet-Infinity-macOS.zip`**) from the [Latest Release](../../releases/latest).
2. Open **`Ricochet-Infinity-macOS.dmg`** and drag **`Ricochet Infinity.app`** to your **`Applications`** folder.
3. Launch **`Ricochet Infinity.app`**.
   > **Note for macOS Gatekeeper:** Because this is a community open-source build signed ad-hoc, if macOS displays an unverified developer prompt on first launch, either **Right-Click → Open** or run:
   > ```zsh
   > xattr -cr "/Applications/Ricochet Infinity.app"
   > ```

Everything (all **1,275 decoded RGBA sprites**, **378 retail rounds**, **27 player ships**, **14 Ion Spheres**, **33 power-ups**, and **227 audio tracks**) is embedded inside `Ricochet Infinity.app`—no Python, external server, or internet connection required.

---

## 🎮 Controls & Gameplay Features

| Input | Action |
| :--- | :--- |
| **Mouse** or **← / → (`A` / `D`)** | Move Player Ship (with 21-frame banking animation) |
| **Left-Click** | Launch Ion Sphere / Fire Active Weapons (Laser Gun, Homing Stinger Missiles) |
| **Right-Click** or **Hold `Space`** | **Ion Sphere Recall** — emits a tractor wave that curves balls in flight toward your ship |
| **`[` / `]`** | Previous / Next Round |
| **`P`** | Pause / Resume Game |

### Included Content
- **38 Retail Level Packs (378 Rounds Total):**
  - **Main Tournament (9 Planets, 146 Rounds):** *Ricochet Station*, *Barrakis*, *Marishka*, *Risa*, *frozen*, *Klendathu*, *Mustafar*, *Tatooine*, *Infinity*.
  - **Episode 2 — Delta Quadrant Add-On (5 Planets, 70 Rounds):** *Yucatan*, *Old Capricana*, *Alpha Centauri*, *Ceti Alpha V*, *zorgon*.
  - **Showcase & Bonus Packs (162 Rounds):** *Examples* (`139` rounds) + `23` Main Menu animated brick showcase patterns.
- **All 27 Retail Ships & 14 Ion Spheres Unlocked** in the **Ship & Ball Hangar**.
- **Real-Time `CBrickPlugIn` Motion Engine:** Executes `CBrickPlugInSimultaneous`, `CBrickPlugInSequence`, `CBrickPlugInOrbit`, `CBrickPlugInMoveToPoint`, `CBrickPlugInSpring`, `CBrickPlugInWaitXSeconds`, `CBrickPlugInWaitForBrickToBeDestroyed`, and `CBrickPlugInDestroySelf`.

---

## 🔬 Reverse Engineering Summary

This project was reverse engineered from the original Windows installer (`ricochet-infinity-.exe`, SHA-256 `f120c914092a6c420eceb406ba9d3c06beeb4a092e6eb52c616d24ae323789b3`):

1. **Outer Wrapper (`ZipLite`):** Carved out `RicochetInfinitySetup.exe` at offset `0x2b804` (`37,339,989` bytes).
2. **Inner Installer (`Inno Setup 5.2.3`):** Decompressed the solid LZMA stream at `0xd000` (`tools/unpack_inno.py`), reversed the 64 KiB block-aligned x86 `E8`/`E9` `CallInstructionFilter`, and verified all **89 files** against their embedded MD5 hashes.
3. **Asset Archive (`data.dat`):** Restored the altered End-of-Central-Directory signature (`RE\x05\x06` → `PK\x05\x06`) to extract all **2,466 game assets**.
4. **Game Engine DLL (`Data3.bin`):** Disassembled the 3.81 MB x86 PE32 engine DLL (`836` C++ RTTI classes) at `0x10163850` (`CSequence_ReadCustomPropBin`), `0x10151cc0` (`CFrame` dual-mode image decoder), and `0x1014ed00` (delta prefix-sum alpha/planar RGBA reconstruction) to decode all **1,275 `.Frame` and `.Sequence` files** (`tools/build_assets.py`).

---

## 🛠 Building from Source

```zsh
# Rebuild Universal 2 macOS App Bundle + Single-File .dmg & .zip
python3 tools/build_macos_app.py

# Or run in a local browser on port 8765
./run_macos.sh --browser
```
