# Observing

The paragraph reads like a report from someone who has looked at the picture long enough to count things. Not a prompt, not a pitch, not a mood board.

## How a good paragraph moves

Annotated specimen — poster, one subject, rain at night:

> A vertical poster illustration, painted in gouache with visible paper grain. *(medium, style, orientation, texture — the whole thing in one breath)*
>
> Behind her, a convenience-store interior reads as a shallow band of warm yellow through rain-streaked glass; shelving survives only as soft horizontal stripes of colour, and the frame of the automatic door cuts a vertical white line from bottom to top. *(background, region, the light source is also architecture)*
>
> She stands just outside that door, half turned toward it, one hand lifted at the handle without touching it. Her hair hangs in wet ropes against a narrow face, a single strand across the cheek. A thin grey coat is dark at the shoulders where rain has gone through, and the collar stands up on one side only. *(subject, pose, head, garment, one asymmetry — this is where invention belongs)*
>
> The upper third is a flat field of wet asphalt grey, empty, with one vertical smear of reflected light entering from the right edge. Beneath her, the pavement is a black mirror carrying two broken reflections, one cool white from the door frame and one amber from inside the store. *(composition, negative space, ground)*
>
> Across the top, in a heavy sans-serif, off-white letters with slight ink spread, the first line reads "深夜营业". *(text: position, typeface, colour, exact string)*
>
> A cold tube light comes from the right of frame at shoulder height, wrapping the wet edge of her hair and leaving the left side of her face in blue shadow. *(light: source, direction, surface response)*
>
> The frame balances a small warm centre against two large cold fields, and the whole poster stays within grey, amber and white. *(closing: balance, palette, mood — once)*

What makes it work: positional sentences, no camera vocabulary, the text appears exactly once, the last sentence does not repeat the first.

Second specimen — looked at, a photographic register, no text:

> A candid early-2000s digicam photograph of a young woman lying flat on her back across a weathered stone tomb in an old cemetery, taken horizontally from a slightly elevated three-quarter angle. She wears a fitted charcoal sleeveless top cut just above the waist and a long black skirt gathered into soft folds, her body running diagonally across the slab, head near the raised cross and skirt spilling toward the lower-left corner. Both arms lie open to either side, palms slack, her chin tipped back. The cemetery behind her is crowded with rounded headstones and rectangular slabs under trees, light breaking through the canopy in irregular patches across the stone. The image carries the artifacts of the camera rather than a look: faded bluish-grey and desaturated green tones, blown highlights in the background, chalky shadow in the black clothing, digital grain, and a slightly crooked amateur framing.

What makes it work: the register is a **camera process**, named in the first clause and paid off in the last; the body is placed by coordinates ("diagonally", "head near the cross", "lower-left corner") rather than by adjectives; the finish clause lists consequences — grain, blown highlights, crooked framing — instead of boosters.

Third specimen — read mode, text-first:

> Anime-style illustration of a blue screen of death filling the whole frame, flat desktop blue with white monospace text; the headline reads "Whoops, Miku.exe ate too much RAM", with a large sad-face emoticon and a small QR code block in the lower right corner. A jagged tear rips horizontally across the middle, edges curling like torn paper, pixel fragments and RGB-split fringe along the split. From beneath the tear a girl's head and one hand emerge, gripping the torn edge, long turquoise twintails spilling over the blue. She looks at the viewer with a half-lidded, smug expression, a ram stick between her teeth. Behind the gap, a cyan void with drifting data fragments. Crisp lineart, high contrast between the flat blue and her lit detail, slightly low angle, playful and mischievous.

What makes it work: the string comes first because the frame is about the string; the typography is named ("white monospace"); the tear is described by physical behaviour ("edges curling", "RGB-split fringe"), not by mood.

Fourth specimen — an edit, instruction form, one change:

> Change image 1.
> 1. Replace the text on the shop sign above the door with "LUCKY STAR", keeping the same condensed serif, the same white on green, and the same centred alignment.
> Everything else stays: the woman's face, hair and pose, the position of her hands, the camera height, the overcast light and the wet reflections on the pavement, the parked bicycle at the right edge, and the four pigeons on the kerb.

Why it holds: the target is unique by position and count ("the text on the shop sign above the door"), the change names the new state and carries the type with it, and the hold list is five specific things plus a blanket. Nothing walks the frame, so nothing gets repainted.

The same edit, handled wrong:

> A cinematic photograph of a young woman walking on a wet street in the rain, wearing a beige trench coat, cinematic lighting, 8K, masterpiece, with a shop sign reading "LUCKY STAR" in neon, dramatic reflections, moody atmosphere, also the pigeons and the bicycle in the background.

That is a new picture, not an edit. It rebuilt the street from adjectives, dropped the identity, changed the light, moved the sign, and added a quality tail. The model will follow it and the face will be gone.

Fifth specimen — the same edit in caption form, where the paragraph still has to carry the hold:

> An overcast street photograph of the woman from picture 1, a dark bob and a beige trench coat, walking on the same wet pavement toward the shop at the corner, whose sign above the door now reads "LUCKY STAR" in the same condensed serif, white on green, centred as before. The rest of the frame holds: the bicycle at the right edge, four pigeons on the kerb, the flat grey sky, the reflections running down the pavement, the same framing and the same camera height.

Why it holds: the change appears as a fact about the finished frame, the hold rides in one sentence, and the paragraph is half the length of the generation caption that would have rebuilt the scene.



Brief: "a girl at a convenience store at night, poster, text 深夜营业".

> A cinematic ultra-detailed 8K masterpiece of a beautiful young woman standing in front of a convenience store at night, dramatic lighting, volumetric fog, hyper-realistic skin, shot on 85mm f/1.4, bokeh background, emotional, award-winning photography, with the text "深夜营业" in neon, post-apocalyptic atmosphere, lonely girl waiting for someone, rain, reflections, high contrast, trending on artstation.

Failures, in order of damage:

1. **Camera kit and boosters** — 85mm, f/1.4, bokeh, 8K, masterwork: the model already renders detail; these words buy a stock-photo look and flatten the direction.
2. **Story** — "waiting for someone" and "post-apocalyptic" are narrative additions. The first invites a second character, the second repaints the entire world.
3. **No positions** — nothing can be placed. The renderer defaults to a centred subject, horizon through the middle, everything competing.
4. **Text as decoration** — "in neon" specifies a material, not a typography; no colour, weight or place.
5. **One undifferentiated block** — no light sentence, no ground, no closing.

The paragraph is long and says less than a third of its length in useful constraints.

## Failures worth naming

**The inventory.** Eight sentences each beginning "There is…". Counts without positions. Fix: give each object a coordinate and a relation to another.

**The adjective ladder.** Three modifiers per noun. Pick the one that changes the render.

**The mood leak.** Feelings instead of evidence: "melancholy", "hopeful", "cinematic". Replace with the thing that produces the feeling — distance, wet glass, a single lit window.

**The hedge flood.** "appears to be", "seems", "suggests" on every line. Two hedges in a paragraph at most, and only where the brief is genuinely open.

**The sycophantic opening.** "A stunning, breathtaking…" — the first sentence is where the medium and composition belong.

**The negative instruction.** "no people, no text, do not add logos" — inside a prompt these often summon the object. Convert to what fills the space, or move to the negative channel.

**The ratio in prose.** "square format", "vertical 3:4" inside the paragraph steals tokens from content and conflicts with the actual parameter. Metadata line only.

**The duplicated sentence.** Two clauses saying the same thing in different words — common in prompts edited by hand. It costs tokens and teaches the model nothing.

**The comma run.** A five-character scene written as one comma-separated inventory. Each character needs a seat, a lean, a gaze and an expression, or the renderer centres everyone in a row.

## Library lessons

Patterns that recur across prompts people actually saved and reused, and the rule each one supports.

1. **Medium noun in the first clause.** "A candid early-2000s digicam photograph of…", "Anime style digital illustration of…", "A cartoon illustration with clean line art…". Three different looks, three different first nouns. The deliverable noun is never dropped.
2. **A finish clause near the end.** Grain, JPEG compression, blown highlights, ink bleeding into cardboard, impasto ridges, screen-print misregistration. This is the one place the register gets a second touch, and it substitutes for every quality booster.
3. **One physical effect that unifies the frame.** Wind streaking the fur into horizontal trails; a tear with pixel fragments along its split; light patches breaking through a canopy. One is enough, and it must follow from the world.
4. **Text quoted and described as type.** The string verbatim, then its material: white monospace, jagged hand-painted lettering, off-white heavy sans. Never "a caption here".
5. **Palette as two families in tension.** Deep garnet against pale ice-blue; warm ivory against Charcoal; grey, amber and white. Not eight unrelated colours.
6. **The gesture, not the pose word.** "Leaning forward to offer the cake toward the viewer", "one hand lifted at the handle without touching it", "a ram stick between her teeth".
7. **Body clauses as short declaratives.** "One leg slightly forward. Her neck slightly raised." Stance is easier to read as a sequence of facts than as a mood.
8. **Setting carries the era.** Wall-mounted CRT, brass sconces along a marble balustrade, a hand-painted cardboard sign propped on a crate. Two or three proof objects date the scene better than a paragraph of period adjectives.

And the same library's defects, which the rewrite must not inherit: quality-token padding, a duplicated sentence, a multi-character comma run with no positions, a negative appended as the last clause ("no character face blur"), the ratio inside the prose, and stage directions aimed at a human ("make it look premium").

## Sentence rhythm

Mix lengths. A four-word sentence after a forty-word one reads as a decision. Start some sentences with the object, some with the place, none with "It is worth noting".

A useful test: read the paragraph aloud with your eyes closed and try to sketch it. Every point where the sketch is ambiguous is a sentence that needs a position or a count, not another adjective.
