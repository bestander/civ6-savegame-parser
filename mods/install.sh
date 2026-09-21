#!/bin/bash
# Install (or refresh) the oracle and lab mods into the game's Mods folder (macOS).
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
MODS="${CIV6_MODS_ROOT:-$HOME/Library/Application Support/Sid Meier's Civilization VI/Sid Meier's Civilization VI/Mods}"
mkdir -p "$MODS/SaveOracle" "$MODS/SaveLab"
cp "$SRC/oracle/SaveOracle.modinfo" "$SRC/oracle/SaveOracle.lua" "$SRC/oracle/SaveOracle.xml" "$MODS/SaveOracle/"
cp "$SRC/lab/SaveLab.modinfo" "$SRC/lab/SaveLab.lua" "$MODS/SaveLab/"
# The plan and command files are written per capture; only seed them when missing.
[ -f "$MODS/SaveOracle/Plan.lua" ] || cp "$SRC/oracle/Plan.lua" "$MODS/SaveOracle/"
[ -f "$MODS/SaveLab/SaveLabCmd.lua" ] || cp "$SRC/lab/SaveLabCmd.lua" "$MODS/SaveLab/"
echo "installed into $MODS — enable both mods under Additional Content → Mods (tick 'ignore warnings')"
