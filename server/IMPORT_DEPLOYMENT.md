# Standalone source import

Ported from vanilla PuzzleScript's 24 October 2026 source-sharing feature.
`import_source.py` accepts one nonempty UTF-8 `source` form field and returns an
editor page containing escaped JSON data. It stores no game source on the server.
The normal static development server does not handle POST requests.

Exported games post the hack form to the public vanilla editor at
`https://www.puzzlescript.net/editor.html`. `nohack` omits that form. No deployment
or routing change is required to export games from Labs.

For a separate Labs deployment, `handle_request(environ, stream, editor_path)`
accepts an explicit editor path; the default path belongs to the vanilla server.
`handle_http(handler)` adapts the receiver to the CGI launcher's HTTP interface.
`cgiserver-import.patch` is an upstream integration example: review actual host
paths and routing before applying it. This port does not configure a server.

The receiver requires `application/x-www-form-urlencoded`, one `source` field,
a complete encoded body no larger than 33,554,432 bytes (32 MiB), and editor HTML
with exactly one `importedSource` marker. URL encoding can make the body much
larger than the original source. Invalid requests return HTTP error codes with
`Cache-Control: no-store`. A 20-second input deadline limits incomplete requests.

Imported pages use an import-only script policy: scripts from the deployed
editor may compile generated functions, while inline event attributes are
disabled. The editor dispatches only numeric `jumpToLine(...)` console links
through its external click listener. The user clicks RUN to compile the source.

From the repository root:

```sh
python3 -m unittest discover -s server -p 'test_import_source.py'
```

Export/browser regressions live in the standalone `puzzlescript_testdump/ui/`
collection. The obsolete `prepare_live_import.js` hotfix for an older vanilla
production release was deliberately not ported. Use the regular Labs build
(`node build-codemirror6.js` if needed, then `node compile.js`).
