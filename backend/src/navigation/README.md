# Nova navigation data

- `navigation-graph.json` records screen IDs, URL patterns, and action edges. It contains no spoken instructions.
- `page-controls.json` records the documented control for each graph action: its ID, label, aliases, optional icon and usual position, location, available choices, conditions, and expected result. Action IDs must stay in sync with the graph.
- `page-information.js` combines those controls with the shared TV catalog and current account data, and matches a spoken button description to documented controls on a page. Catalog names are read from `tv-catalog.json`; they are not copied into the graph.
- `navigation-routes.js` validates a reported TV route and finds the first shortest path. Some older graph edges represent two physical controls; the returned `control.sequence` names both.

The TV app reports its URL plus whether the main menu or notifications dialog is open. It does not report focus, search text, or every action that stays on the same route. Page controls describe documented possibilities; they are not proof that a control is currently focused or that an action has completed.

Gemini can choose `get_navigation_route` for a route and `get_page_information` for page controls or catalog items. Vague watch goals return a clarification. Named watch goals are routed through the catalog page with a verified selection control. Button descriptions are matched against this JSON, not TV button events. The usual position is documentation, not a live measurement. New graph actions need a matching page control and a valid target screen.
