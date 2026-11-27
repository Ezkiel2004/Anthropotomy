# Female body mode and the missing textbook parts

Date: 2026-11-27. Approved by the user in conversation on 2026-11-27 ("Yes, go ahead").

## Intent

The 3D explorer's body is Z-Anatomy's, which is male. The female reproductive layer (Stanford model, fitted into
the Z-Anatomy pelvis) therefore sits in a male body: with the urinary layer on, the vagina runs through a man's
bladder, and the male urethra, testicular vessels and penile vessels stay on screen next to the uterus. The user
wants the body around the female organs to be female too: when someone switches on the Female Reproductive
System, every other system that has a part that differs between men and women shows the female version of that
part.

The user also compared the explorer with a textbook list of major parts per system (2026-11-20). Most gaps cannot
come from Z-Anatomy (see the memory note "Z-Anatomy source gaps"); this work adds them from openly licensed
models.

## Goals

1. **Female mode.** Turning on the Female Reproductive System puts the body in female mode; turning it off returns
   it to male. In female mode each loaded layer hides its male-only parts and shows its female-only parts in the
   same place. Today's male view stays exactly as it is.
2. **Female parts for the systems the user named:**
   - urinary: female urethra and female bladder (Z-Anatomy's bladder is a man's and overlaps the vagina);
   - circulatory: ovarian arteries and veins, uterine arteries and veins, in place of the testicular and penile
     vessels.
3. **Female pelvis and pelvic floor** (skeletal, muscular), if the scanned female pelvis can meet Z-Anatomy's
   femurs, sacrum and lumbar spine without visible gaps. Decided after the fit is measured (Phase 3).
4. **The other missing parts** that a usable source exists for: ileum and caecum (digestive, split from
   Z-Anatomy); mammary glands and labia majora (female reproductive). The rest of the user's list is reported as
   still missing (see "What the downloads turned out to contain").

## Non-goals

- A whole female body: height, proportions, skin, face, and muscles and bones away from the pelvis stay
  Z-Anatomy's.
- Adrenal cortex and medulla, islets, nephrons and other microscopic structures (no usable human model; the
  system descriptions cover them in text).
- A separate Male/Female control, or a body sex that persists after the reproductive system is switched off
  (approaches B and C below).

## Anti-goals (failure even if it technically works)

- A part that floats, pokes through a bone, or leaves a visible gap where it meets a Z-Anatomy part.
- The male view changing in any way.
- A hidden part that can still be clicked, hovered, framed by the camera, listed in a study section or found by
  name.
- A layer file over the 8 MB budget, or a model file over 100 MB in Git.
- A source whose licence is not CC BY, CC BY-SA or CC0, or a source left uncredited.

## Approaches considered

- **A. Follow the female reproductive switch (chosen).** Female mode is on exactly while the Female Reproductive
  System is on. No new control: the two reproductive switches already are the male/female choice and can never be
  on together. A student who wants the female urinary system switches on both.
- **B. Sticky body sex.** The body stays female after the female system is switched off, until the male system is
  switched on. Rejected: the body's sex would depend on history the screen does not show.
- **C. Separate Male/Female switch.** Rejected: a new control and a third state to explain, for a need A already
  covers.

## Sources (all downloaded with the user's approval on 2026-11-27; kept out of Git)

| Use | Model | Author | Licence |
|---|---|---|---|
| Female bladder, urethra, vulva, cervix, pelvis, pelvic vessels | Bony Pelvis, Supply, Organs from MRI (8c12064abe744fc7b13fe9aded2d4b02) | audreybyrd | CC BY |
| Ileum, caecum | Small and large intestine (8a1ca8e3ca224cdeb9264674416bde38) | antonia.sundberg | CC BY |
| Heart septum, valve leaflets | Interior heart, medium detail (9e1e685301984ae5a90c2fd97e871fd0) | anatomy_dundee | CC BY-SA |
| Renal cortex and medulla | Kidney Cross-section (b59cc02d4e964af7a2c1fcb0001919d8) | thunderpig | CC BY |
| Mammary glands | Human Female Breast Anatomy (e521ddef44924d67a612d41764779505) | docjana | CC BY |
| Scrotum, bulbourethral glands | MALE REPRODUCTIVE SYSTEM (17bdcd1c2e9046d1abde72eff5c2cd0d) | prabhatsharma8030 | CC BY |

Each source gets `tools/blender/sources/<name>/README.md` (title, author, link, licence, what is used, what the
export changes), like the Stanford model. The downloads live in `system_model/sources/<name>/` (glTF archives,
ignored by Git).

### What the downloads turned out to contain (inspected 2026-11-27)

| Model | Contents (meshes are unnamed; identified by rendering each group) | Verdict |
|---|---|---|
| Pelvis from MRI | 15 groups: hip bones, sacrum and coccyx, joint cartilages, femurs, L3 to L5 and discs, **bladder with urethra** (one mesh), **uterus with tubes and vagina**, **ovaries**, rectum, **vulva** (one surface with the urethral and vaginal openings), arteries (aorta to femoral, with internal iliac branches), nerves (lumbosacral plexus) | Used: bladder and urethra (cut apart), vulva (as labia majora), pelvis for the Phase 3 fit test |
| Small and large intestine | Large intestine (caecum, appendix, colon, rectum) and small intestine, one mesh each | Not needed: Z-Anatomy already has both (below) |
| Interior heart | The heart is one 1.4M-vertex sculpt with a window cut into it, plus coronary vessels | Not usable: no separate septum or leaflets |
| Kidney cross-section | 32 unnamed pieces of a half kidney cut lengthwise | Not usable as cortex and medulla parts |
| Female breast | Body surface, pectoral muscle, **glands**, **ducts** (one breast) | Used: glands and ducts as the mammary gland, mirrored for the other side |
| Male reproductive system | A stylised half-cut teaching model; no scrotum, no identifiable bulbourethral glands | Not usable |

Like the rectum and anal canal, two more gaps are already in Z-Anatomy under another name, and come from splits
instead of new models:
- **Ileum.** Z-Anatomy's "Jejunum" is one 1.89 m tube from the duodenum (6.5 mm away) to the ascending colon
  (6.5 mm away): the whole jejunum and ileum. Textbooks give the jejunum the first two fifths and the ileum the
  last three, so the tube is split at 40% of its length from the duodenal end. A plane cannot do this (the coils
  cross any plane many times), so the split follows the curve's length.
- **Caecum.** Z-Anatomy's "Ascending colon" runs below the point where the ileum enters it (z 0.9652; the
  appendix joins 1.1 cm lower). The part below that level is the caecum: a horizontal plane split, like
  SPLITS.

Still missing after this work (no usable model found): interventricular septum, the anterior atrioventricular
valve leaflets, renal cortex and medulla, scrotum, bulbourethral glands.

No model was found for the ovarian and uterine vessels. The ovarian artery and vein start where the testicular
ones do and follow the same path down the posterior abdominal wall, so they are made from Z-Anatomy's testicular
vessels: kept down to the pelvic brim, then continued as a smooth tube (same radius) along the suspensory ligament
to the ovary. The uterine vessels come from the MRI model if it has them, otherwise they are drawn the same way
from the internal iliac artery and vein to the side of the uterus at the cervix, crossing above the ureter.

## Design

### Part data

- Every part may carry a glTF extra `sex`: `"male"` or `"female"`. A part without it belongs to both.
- `export_layers.py` gets `MALE_ONLY` (Z-Anatomy structure names): Urethra, Urinary bladder, the
  testicular arteries and veins, the deep and dorsal arteries of the penis, the deep and superficial dorsal veins
  of the penis. Pelvic bones and pelvic floor muscles join it only if Phase 3 swaps them.
- Female parts are added to the layer of their own system (female urethra and bladder in `urinary.glb`, ovarian
  and uterine vessels in `circulatory.glb`), not to the female reproductive layer, so each system's study
  sections, part cards and quizzes keep working. A female part that is the same structure as a male one keeps
  its name (Urethra, Urinary bladder) with the female description.
- Parts from other sources are fitted with the method `export_female_reproductive.py` already uses (similarity
  fit onto the matching Z-Anatomy structures, then pushed clear of bones), moved into a shared module so each
  system's export can call it. Part ids: `za_` for Z-Anatomy, `fem_` for female-only, and a short source prefix
  for new parts present in both sexes.
- The ileum and caecum belong to both sexes and carry no `sex`. The mammary glands and labia majora go into the
  female reproductive layer (which is female-only already) and need no tag.

### Explorer

- The engine keeps one body sex, `"male"` by default. `setBodySex(sex)` sets the visibility of every tagged part
  in every loaded layer; a layer loaded later applies the current sex when it is adopted.
- `main.js` sets the body sex to `"female"` when the Female Reproductive System is switched on and back to
  `"male"` when it is switched off, before the layers update, so no male part flashes on screen.
- A part hidden for sex is skipped by picking, hover, camera framing and the study tray, is left out of study
  sections and search, and stays hidden when the study tray closes (the tray currently restores
  `visible = true` on every part it hid). If the focused or hovered part becomes hidden, focus and hover clear.
- The decision "which sex does this part show in" lives in `anatomy-layers-core.js` as a pure function, with unit
  tests next to the existing ones.

### Phases

1. Download and inspect the six models (part names, scale, which structures are separate).
2. Female mode in the explorer plus the urinary and circulatory female parts.
3. Female pelvis and pelvic floor, if the measured fit passes the anti-goals; otherwise reported and skipped.
4. The other missing parts, one system at a time, each re-exported, checked on localhost and committed.

## Left to the builder

- Which mesh of each model becomes which part, the fit landmarks per model, and cut planes where a model merges
  structures, decided after inspecting each model.
- Tube radius and path details for the generated vessels, within the anatomy described above.
- Texture handling per source (the female layer keeps its textures; other layers are untextured and coloured by
  tissue).
