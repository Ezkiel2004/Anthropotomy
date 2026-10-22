# Stanford female reproductive system

Source model for the female reproductive layer (`system_model/layers/reproductive-female.glb`), which
`tools/blender/export_female_reproductive.py` fits into the Z-Anatomy pelvis. Z-Anatomy has no female
reproductive organs.

| | |
|---|---|
| Title | Female Reproductive System |
| Author | [stanfordedtechteam](https://sketchfab.com/stanfordedtechteam) |
| Source | [sketchfab.com/3d-models/female-reproductive-system-c4d5e725198d4a1997c641d548bb20ce](https://sketchfab.com/3d-models/female-reproductive-system-c4d5e725198d4a1997c641d548bb20ce) |
| Licence | [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/) |

The download (glTF binary, 171 MB, most of it textures) is not kept in Git: GitHub refuses files over
100 MB. To export the layer again, download the model from the source above and save it as
`system_model/female_reproductive_system.glb` (that path is ignored by Git).

What the layer uses: the uterus with the vagina (cut into Uterus and Vagina), the uterine tubes, ovaries,
round and broad ligaments of the uterus, bulb of vestibule, clitoris, greater vestibular glands and labia
minora, each pair split into left and right parts. Left out: the model's pelvis, sacrum, bladder, rectum and
pelvic floor muscles (the skeletal, urinary, digestive and muscular layers have their own), the tendinous
arch of levator ani and the cut-away copy of the uterus.

Changes made by the export: the organs are fitted into the Z-Anatomy pelvis and pushed clear of its bones
(Z-Anatomy's pelvis is male and narrower), reduced to about 30% of their triangles, and drawn in the
explorer's tissue colours instead of the original textures.
