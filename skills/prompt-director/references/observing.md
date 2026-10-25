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

## Contrast: the same brief, handled wrong

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

**The hedge flood.** "appears to be", "seems", "suggests", "likely" on every line. Two hedges in a paragraph at most, and only where the brief is genuinely open.

**The sycophantic opening.** "A stunning, breathtaking…" — the first sentence is where the medium and composition belong.

**The negative instruction.** "no people, no text, do not add logos" — inside a prompt these often summon the object. Move them to the negative channel or drop them; an empty frame is described by what fills it, not by what is missing.

**The ratio in prose.** "square format", "vertical 3:4" inside the paragraph steals tokens from content and conflicts with the actual parameter. Metadata line only.

## Sentence rhythm

Mix lengths. A four-word sentence after a forty-word one reads as a decision. Start some sentences with the object, some with the place, none with "It is worth noting".

A useful test: read the paragraph aloud with your eyes closed and try to sketch it. Every point where the sketch is ambiguous is a sentence that needs a position or a count, not another adjective.
