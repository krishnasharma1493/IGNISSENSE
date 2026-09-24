# Production rationale

## Taking the voice out changed the edit, not just the audio

A narrated cut can hold a shot while a sentence finishes. A silent one cannot, so the pacing had to be
rebuilt from reading time instead of speaking time. Scene lengths now come from how long a caption and
the UI underneath it take to absorb, which is roughly nine to twelve seconds for a dense panel and
eight for a simpler one. The film came out at 2:39, about twenty seconds shorter than the narrated
version, because a lot of what the voice was doing turned out to be restating what the screen already
showed.

Every spoken line was tested against one question: can the frame carry this on its own? Most could. The
line about matching against 341,086 OpenStreetMap features survived, because no frame states that
number. The line explaining that persistence and anomaly are scored separately did not need to survive
as prose, because the product prints that explanation itself, in its own words, in the panel — the
camera just holds on it long enough to read.

Captions are two lines at most: a label, a claim, and sometimes one supporting figure. Nothing on screen
is a paragraph.

## The opening

Three beats, nineteen seconds, all of it built from real footage and the real class taxonomy.

The first is the national map under FIRMS colouring with one line: the feed reports where a satellite
saw heat, and then, three and a half seconds later, that it does not report what was burning. The delay
matters — the viewer should look at the identical red dots before being told what is missing.

The second dims that same map and fans one detection out to the six classes it could be, using the
product's own class colours from `CLASS_CONFIG`. This is the only diagram in the film that explains a
problem rather than a mechanism, and it exists because there is no screen in the product that shows
ambiguity. Underneath it, the scale: 4,218 detections in the past seven days, and the type decides who
should act.

The third is the toggle. One real click, and the country recolours. That single state change is the
strongest thing the product does on camera, so it ends the setup rather than opening the walkthrough.

## The one diagram that is not the product

After the toggle a judge should be asking how. The pipeline card answers it in four stages on a drawn
line — FIRMS, spatial context, history at the spot, XGBoost — each carrying the actual parameter it
uses. It is there because the transformation between a hot pixel and a class is the one part of the
system with no screen of its own. It is deliberately four labels and four short figures, not an
architecture chart with every service on it.

## The case

The alert, the flight, and four panel scenes carry one detection at the Hazira steelworks from a
flagged row to an explained event. It was picked out of the live open-alerts list by matching its
text, not staged: critical, industrial fire at 80%, anomaly 0.90, 1,141 m from ArcelorMittal Nippon
Steel India, 37.0 MW against an 8.0 MW baseline over 50 prior overpasses.

The order puts the alert before the classification on purpose. The most commonly missed point about
this system is that the alert rule never consults the classifier, and showing the rule first makes that
harder to miss.

## Focus boxes instead of a pointer

The investigation panel is dense, and with no voice there is nothing to say "look here". So four scenes
draw a two-pixel outline in the application's own accent colour around the element the caption is
talking about: the nearest-site rows, the six probabilities, the two score tiles, and the refusal
message. The box is nested inside the video wrapper so it scales with the camera move and stays
registered to the element under it. Coordinates were measured off the rendered frames, then checked
against the output.

## Ending on the refusal, nearly

The second-to-last product scene is a detection the system will not classify, because nothing is mapped
within 25 km of it. It is there because a system that always produces an answer is less trustworthy
than one that says when it cannot. The dashboard then closes on what an operator is actually left
holding: 12,585 detections, 125 behaving unusually, a short list rather than a feed of red dots — which
is the image the film opened on.

## Tooling

Hyperframes, the renderer underneath the `/brag` plugin, drives the composition: an HTML and GSAP
timeline rendered deterministically frame by frame, with the audio muxed in and a lint, layout and
contrast gate in front of it. That gate caught a contrast failure on a card source line in the previous
cut and passes 16 of 16 text checks on this one. The `/brag` skill itself was not used; its creative
law targets a fifteen to twenty-five second launch video, which is the wrong shape here.

## Sound

There is a quiet synthesised bed and six short interface sounds placed on interactions the viewer can
see happen. The film is built to be read with the sound off; the audio is there so it does not feel
broken when someone leaves it on.
