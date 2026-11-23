# Gameplay numbers

Edit these files in the source repository, then publish the changes through the
desktop release workflow described in `..\..\desktop\README.md`:

- `units.js`: unit speed, health (`hp`), attack die (`atk`), range, production
  cooldown, and specialist values. Structure health is in the same file.
- `rules.js`: starting AP and missiles, AP growth, missile damage and radius,
  resupply distance, repair time, and other shared limits.

Use non-negative numbers. AP growth interval, die sizes for health, and
turn intervals must be positive integers. Keep unit and structure keys and
JavaScript punctuation intact. The descriptive `notes` and in-game rules text
are separate from the numbers; update those descriptions when appropriate.
Restart the game after editing. Both online players must have matching balance
files; a mismatch is rejected rather than letting the match desynchronize.

These are source files, not personal settings: editing one player's installed
copy will not publish or synchronize the change. To distribute a change, commit
and merge it to `main` so the release workflow builds a new installer.
