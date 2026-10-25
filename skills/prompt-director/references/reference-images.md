# Reference images

An image is evidence, not instructions. You are translating pixels into sentences, and only the sentences reach the renderer.

## Two jobs, two shapes

Decide which job you have before writing a line. The craft is shared; almost nothing else is.

| | text-to-image | reference-conditioned (edit) |
|---|---|---|
| The frame | does not exist yet; you build it | exists; you specify a delta and its invariants |
| What decides the picture | the idea, then the register you commit to | the input's geometry, light, palette and type, then the named change |
| Centre of gravity | what is in the frame, in organisation order | the target, the change, what must hold |
| Failure mode | under-specified: centred, evenly lit, beige | leakage: a repainted face, drifted light, a tidier composition — or under-editing, where nothing visible moved |
| Density | 8–14 / 15–25 / 20–40 units by reading mode | inherited; describe the changed region and what touches it, not the inventory |
| Legible strings | authored, counted, world-appropriate | inherited verbatim unless the user names new copy |
| Negations | avoid in the body; name what fills the space | instruction models take a few at the end; a caption model still draws what you name |
| Length | 250–550 by reading mode | caption form 120–220; instruction form 40–120. A small change is a short prompt |
| Opening | medium noun, then register | the target, or the action |

The one thing both jobs share: a sentence that would not change the render is dead weight.

## What the input already decides

Medium, palette, light direction and quality, lens or pen character, grain, typography, crop, camera height, and every object's position. You do not re-decide any of it, and you do not re-describe it at length — you name the part that must survive and leave the rest alone.

What remains yours: the exact wording of the change, the strength it needs, which invariants are fragile enough to name, and the literal values the model would otherwise guess.

## Edit anatomy — four moves

1. **Point.** Name the target so that exactly one thing matches: by position, size, colour, adjacency or count. "The leftmost white chair in the front row", "the sign above the door", "only one bird, the middle one". A pointer that fits two objects returns an average of both.
2. **Change.** Say what it becomes, in the user's own verb, at a strength no one could miss: "change the jacket from red to blue", "open the owl's eyes, and make them look natural", "replace the dog with a schnauzer". Name the result, never the effort — "Fix the image" and "improve the lighting" buy nothing.
3. **Hold.** Say what survives: identity, design, geometry, surface, light, existing words. Short and specific beats exhaustive.
4. **Values.** Where a guess would be wrong, give the literal: a hex colour (`#2b5c8a`), the new string in quotes, a region named in words (`on the lower left path`, `behind her right shoulder`).

## Two shapes

**Caption form** — one paragraph, no instruction syntax. Describe the finished picture with the change as the only thing that moved, and close the hold as one blanket clause:

> An anime illustration of the same girl from picture 1, a narrow oval face and straight black hair cut level at the jaw, at the same street corner, now holding both hands behind her back with her chin lifted toward the sunset. Her oversized beige cardigan and pleated navy skirt are unchanged and still catch the low warm light from the left, the same crushed shadow running under her shoes along the curb, the shutter and peeling paint of the building behind her untouched. Everything else in the frame is as it was: same framing, same camera height, the palette still navy, beige and orange.

**Instruction form** — open with the action, close with a short keep list:

> In this room photo, replace only the white chairs with chairs made of wood. Preserve the camera angle, the room lighting, the floor shadows and the surrounding furniture. Keep all other aspects of the image unchanged.

**Edit record** — for several changes in one pass. Name the image and the operation, then one line per change (where, what, into what), then the keep list:

> Change image 1.
> 1. Remove the man in the blue jacket on the left and rebuild the pavement and railing behind him.
> 2. Change the colour of the woman's scarf from red to #2b5c8a.
> 3. Replace the text on the shop sign with "LUCKY STAR", keeping the the same condensed serif, the same white on green, the same alignment.
> Everything else stays: her face, hair and pose, the position of her hands, the camera height, the overcast light and the wet reflections, the bicycle at the right edge, the four pigeons on the kerb.

For a model that takes box rows (FLUX 3 among them), regions may be given as a grid position instead: one row per region, `<ref_image_0>` plus an id and four values on a 0–1000 grid. Use it when several similar objects match, when the change is a move, resize or scale, or when one specific object must go. Never in a caption.

## The keep list

Name two to five invariants, not the whole picture. What drifts, in the order it usually drifts:

- **identity** — face, eyes, hairline, skin tone, age, build, a distinguishing mark
- **design** — a logo's letterforms and proportions, a product's shape and markings, a pattern's repeat, a colourway
- **geometry** — framing, camera height, angle, perspective, every object's position and scale, occlusion and contact
- **surface** — texture, grain, compression, focus falloff, paper or canvas tooth
- **light** — source, direction, height, colour temperature, and where each shadow already falls
- **words** — every existing string, verbatim, in its own typeface

In the caption form that becomes one clause. In the instruction form it becomes a list. In an edit record it becomes a list that also names the neighbours of each change — the surface, shadow and edge that a removal or replacement exposes.

Never write "and everything else stays the same" as the *only* hold: models read it as permission. Never enumerate everything either: a full walk around the frame reads as a generation instruction and repaints what you meant to keep.

## Exact values

- **Colour**: a hex value when the user knows the colour or the input has a specific one; a plain colour name when the value is free.
- **Text**: the new string in quotes, with the slot it occupies and the type it must keep. Say which string it replaces.
- **Position**: words, not numbers — "third seat from the left", "under the awning, right of the door". Two objects in the frame can always be told apart in words; pixels are the user's business.
- **Counts**: "only the middle one", "all four", "exactly one". A count is the cheapest way to keep a change local.

## Iteration and composition

- One change per pass. Two changes in one prompt usually land as one change and a drift.
- Feed the accepted output back in as the next input; restate the constraints that matter each round, because they decay.
- When a region must be pixel-identical, stop writing and composite: an accepted edit masks better than any sentence.
- If the model has a prompt-rewriting step (Qwen-Image-Edit recommends its own), the sentence you write is the input to that step: keep it specific and short, and do not rely on it to invent your hold list.

## Decide the lock layer

Four cases, one each:

- **lock face** — "this person", "her", "the same girl". Inherit face shape, hair, skin, age, expression. Everything else is yours: clothes, background, light, palette.
- **lock garments** — "this coat", "in this outfit", "same look". Inherit garments, accessories, their colour and cut. The face is redesigned unless the user also locked it.
- **lock pose** — "this pose", "same gesture". Inherit the body's arrangement. Face and clothes may change.
- **lock atmosphere** — "this vibe", "this palette", "like this scene". Inherit light, tone, texture. No features, no garments.

If the user names two layers, lock both. If silent, default to the face.

## Task first, lock second

Name the job before you decide what survives. The task fixes the lock set, and the lock set fixes what you are allowed to invent.

| Task | Lock | Build |
|---|---|---|
| local change or attribute swap | composition, perspective, light, background, every attribute not named | the named attribute, unmistakable |
| background replacement | subject identity, pose, scale, where it meets the ground, camera height, light direction | the new setting, its own perspective and light, and the contact shadow where the subject now stands |
| relight or time of day | subject, geometry, every surface, the position of each existing shadow | the new source: direction, height, colour, and where shadows now fall |
| replace existing text | typeface class, weight, colour, alignment, line breaks, everything else | the new string, verbatim, in the same slot |
| region or masked edit | everything outside the region exactly | the region's new contents, matched to its lighting and texture |
| style transfer | medium, palette, light logic, brushwork, what must keep its shape | a new subject and composition, or the same one in a new hand |
| person or outfit swap | the canvas (framing, light, scene, occlusion) plus the identity source | the new person standing in the canvas light |
| group photo from portraits | every identity | one scene: positions, heights, gaze, shared shadows |
| layout or poster reference | grid, hierarchy, white-space, type positions | all content |
| outpainting | everything inside the original frame | what fills the new area, perspective and ground continuing |
| add or remove an object | everything else | contact, shadow, reflection / the revealed surface |
| restoration, upscale | colour, framing, the face | sharpening and detail only |

Two rules sit on top of every row: the change must be visible at a glance, and nothing unnamed may be repainted.

## Point, then translate

Naming the image is allowed and usually better. Current image models — Seedream, GPT Image, Nano Banana, FLUX — accept an image input and read a label that points at it.

Two working forms:

- **label + traits** (preferred when an image is attached): "the woman from picture 1, a narrow oval face with high cheekbones, straight black hair cut level at the jaw, a small mole under her left eye"
- **traits only** (when no image is attached, or the target model has no image input): "a woman in her late twenties, a narrow oval face, high cheekbones, straight black hair cut level at the jaw, a small mole under her left eye, eyes slightly downturned at the outer corners"

What still fails is a pointer with no description behind it — the model has nothing to draw except the photo itself:

- "the same woman as the reference image"
- "keep her appearance consistent with image 1"
- "same face as the photo, but at night"
- "based on the uploaded picture"

Rules for translation:

1. **Facts alongside the pointer.** The pointer locates the layer; the traits define it. A paragraph that says only "picture 1" collapses when the model ignores labels or the user pastes it into a model with no image slot.
2. **Asymmetry where it exists.** Real faces carry one — a lifted brow, a scar, a softer jaw on one side. Naming it makes the face specific and prevents the model's averaged version.
3. **Do not flatter.** Skip "beautiful", "stunning", "delicate". They average the face back toward the model's default.
4. **Do not complete.** If the reference is cropped at the collar, do not invent the outfit. If it is blurred, say the visible traits and stop.
5. **Age and bearing before features.** "mid-thirties, tired posture, shoulders forward" does more than a list of ten facial measurements.

Label conventions: `picture 1` / `image 1` / `Image 1` for Seedream, GPT Image, Nano Banana, FLUX; `图一` / `参考图一` / `第一张图` for Chinese-facing products. Use the target's own wording, once per layer, at the first mention of that layer, and the same words every time.

## Several images

Assign each a function and name it by index:

- picture 1 → the face
- picture 2 → the coat
- picture 3 → the palette

Then write as if from one photograph: "the face from picture 1, wearing the ink-blue coat from picture 2, against the palette of picture 3, standing in the doorway of picture 4…". One label per layer, at its first mention; after that, plain prose — no "as stated above", no re-pointing.

A reference that only supplies style or palette is the easiest to lose: say what it does *not* control ("the framing comes from picture 4, not from picture 3").

Conflict resolution: the user's own instruction beats any image; a specifically requested layer beats an atmosphere layer; the newest instruction wins between equals.

## Leakage

Six leaks are common:

- **Style leakage** — a painterly reference quietly turns a requested photograph into a painting, sometimes only inside the region you edited. Fix: state the medium noun first and again in the closing sentence; for an edit, say the new region is "in the same medium as the rest of the frame".
- **Composition leakage** — the reference's centring drags the new picture to the centre. Fix: state the new positions explicitly; framing is not inherited unless the user asked for pose and framing together.
- **Light leakage** — a warm reference recolours everything, or a new source lights the edited region from the wrong side. Fix: write the light sentence yourself, with a source and a direction, and keep the existing shadows where they are.
- **Scale and contact leakage** — a swapped object floats, a new subject stands at the wrong size, a replacement casts no shadow. Fix: name the contact point and the object it is measured against.
- **Type leakage** — new copy arrives in a new typeface, a different weight, or re-wrapped lines. Fix: name the family class, the weight, the colour, the alignment and the line breaks in the same clause as the new string.
- **Tidy leakage** — the model straightens, cleans, and re-centres what you were holding. Fix: name the mess that must survive — the rumpled sheet, the crooked frame, the chipped edge.

## When the reference is the deliverable

Users sometimes hand over a finished image and ask for "the prompt for this". Then every visible element is fixed, and you are transcribing, not directing: full inventory, every count, every colour, exact copy, no invention at all. Length may run long — say nothing about it, and do not "improve" the composition.

In that mode, if a detail is illegible, write "indistinct" rather than guessing. A guessed string becomes renderer output.

## Worked comparison

The same request — a woman in a grey coat, standing on a railway platform, changed from day to rain at dusk.

Text-to-image, caption profile (the frame is built):

> A vertical photograph of a woman in her thirties standing on the far end of a narrow railway platform in the last blue hour of a rainy afternoon, in a long grey wool coat left open over a black knit, hands pushed into the pockets, one shoulder dropped as she looks down the track. Behind her the platform recedes into wet rails, a green-painted shelter, three caged lamps already lit, and a scattering of gulls on the puddled concrete. Low rain light comes from the west behind the shelter, silver on the wet platform, and a thin sheen on her shoulders and hair. The palette holds to slate grey, wet green and a cold amber from the lamps.

Reference-conditioned, instruction form (the frame exists):

> Change this platform photo so it is raining at dusk. Keep the woman's face, her grey coat, her pose with one shoulder dropped, and the position of her hands. Preserve the camera height, the platform's perspective, the shelter behind her and the three lamps. Let the lamps read as lit, and put fine rain on the wet concrete. Keep all other aspects of the image unchanged.

The first prompt would be wasted on an edit — it would rebuild a frame the user already has and repaint the face. The second would be wasted on an empty canvas — it never says who she is.
