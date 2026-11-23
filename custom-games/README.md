# Tactical Map War Game source

The active game is `tactical_map_war_game_v2_1_custom_map_edition.html`.
Its source is grouped by function:

- `game\balance\` - editable gameplay rules and unit definitions.
- `game\core\` - game state, audio, and startup.
- `game\multiplayer\` - online synchronization and replay state.
- `game\maps\` - map loading, terrain, and pathfinding.
- `game\planning\` - setup, orders, fog of war, and player handoff.
- `game\simulation\` - simultaneous movement, combat, and logistics.
- `game\interface\` - interaction, interface updates, and rendering.
- `maps\` - sample maps, including `nyc map.txt`.
- `tools\map-converter\` - the 3MF map converter's JavaScript.
- `legacy\` - code, styles, and manual for the older v2.1 game.
- `tests\` - browser regression pages.
- `desktop\` - Windows desktop wrapper and installer.

The root HTML files remain entry points for the active game, the map converter,
and the older game.

The active game's scripts are ordered classic scripts that share the same
browser global scope; they are not independent JavaScript modules. Keep the
script order in the HTML when editing or packaging the desktop application.

The browser regression pages are `tests\planning.html` and
`tests\online-map.html`. Serve `custom-games` over HTTP to run both; the online
test loads the NYC map and exercises a local WebRTC connection. Desktop build
instructions are in `desktop\README.md`.
