# Symbol inspection

Hover an object, alias, property or aggregate name in the editor to see its
declaration, sprite previews, collision layer and the properties or aggregates
that include it. Indirect memberships show the intermediate names. A property
shows its `or` definition and sprite alternatives; an aggregate shows its `and`
definition, individual members and combined sprite.

Hover a character in a level map for the same information about its object or
legend definition, including combined sprites for aggregate glyphs. The card
can be pinned just like a name hover. Level messages and comments are excluded.

Collision layers show the entity names as written in `COLLISIONLAYERS` on a
single line, truncating with an ellipsis when needed. Entries containing the
hovered name indirectly through a property or aggregate use a distinct colour.
Click the list to jump to the layer declaration.

Choose **Pin** or the rule count to dock the inspector below the source. It
keeps the selected name while you scroll or hover other names. Click a related
name to inspect it and jump to its declaration. Rule references are split into
direct mentions and an expandable group of references through properties or
aliases. Each authored rule line appears once, even if it mentions a name more
than once. Long reference lists load in batches of 30.

The inspector reads current source without requiring a successful compilation.
It refreshes after edits; deleting a pinned name shows a missing-declaration
message. Close it with its **×** button or Escape. Escape dismisses an open hover
first. Inspection does not change the game text or its saved/dirty state.

In MIS, Transform hovers use the game's source definitions. Pinning or following
a declaration opens the Source tab. Sprite painting and Ctrl/Cmd-click
declaration navigation remain available.

The declaration index is cached by source document and stops at `LEVELS`.
The editor uses CodeMirror's native hover and panel infrastructure. The combined
runtime/plugin Brotli budget is 110 KiB, allowing the symbol index and inspector
in addition to the original editor integration.
