# Third-party notices

Wildshard's own code, art and data in this repository are Copyright
(c) 2026 Jake Verbaten. All rights reserved. No licence is granted.
Being public on GitHub lets people view and fork this repository as
GitHub's terms allow, and nothing more.

What's listed below isn't ours. It keeps its own terms, reproduced in
the appendices. This list was traced from the singleplayer repository
at `cf55c7d262` on 2026-11-07, by source family, not file by file.

| What | Where | Source | Terms |
|---|---|---|---|
| Drowned Captain model | `public/assets/gpu/models/driftwood-hero/captain/` | Tencent Hunyuan 3D 2.0 | Community licence, Notice below, Appendix A |
| Music | `public/assets/music/` | MiniMax-Music3 | Community licence, Appendix B |
| Sound effects | `public/assets/sfx/` | MOSS-SoundEffect v2, Stable Audio 3 Medium | Apache-2.0 for MOSS. Stability AI Community License and Gemma terms for Stable Audio, Notices below, Appendix C |
| Fonts | `public/fonts/` | Caveat, JetBrains Mono, Rajdhani | SIL OFL 1.1, Appendix D |
| Physics runtime | `public/assets/physics/rapier.wasm`, copied at build | Rapier | Apache-2.0, Appendix E |
| Texture transcoder | `public/basis/r186/`, copied at build | Basis Universal | Apache-2.0, Appendices E and F |
| Free camera | `src/client/engine/explore/FreeCam.ts` | three-freecam 0.2.0 | MIT, Appendix G |
| Pine Hollow hero props, dragon hook | `public/assets/gpu/models/pine-hollow-hero/`, `public/assets/nine-dragon/lab/grapple/dragon-hook.glb` | TRELLIS.2 | MIT |
| Practice dummy hit clips | `public/assets/practice/dummies/unimate-motion.glb` | UniMate v2 | MIT |
| Textures, skies, props | `public/assets/tex/`, `public/assets/hdri/`, `public/assets/models/`, and their copies in `public/assets/gpu/` | Poly Haven | CC0 |
| Four agent skills | `.claude/skills/{codebase-design,improve-codebase-architecture,retro,writing-for-agents}/` | Matt Pocock | MIT, each with its `LICENSE` |

Some bark textures under `public/assets/tex/` are made by our own
scripts, so they fall under the copyright line above.

npm packages are installed, not copied into this repository, and each
keeps its own licence. The ones the game loads at run time include
three (MIT), postprocessing (Zlib), n8ao (ISC), navcat (MIT), fflate
(MIT), valibot (MIT) and `@sentry/browser` (MIT).

## Notices

### Tencent Hunyuan 3D 2.0

Tencent Hunyuan 3D 2.0 is licensed under the Tencent Hunyuan 3D 2.0
Community License Agreement, Copyright © 2025 Tencent. All Rights
Reserved. The trademark rights of "Tencent Hunyuan" are owned by Tencent
or its affiliate.

Powered by Tencent Hunyuan.

The Drowned Captain model was changed from the model's output: it was
simplified, its texture was resized and re-encoded, and it was
compressed.

Wildshard is provided by Jake Verbaten. Tencent is not affiliated with,
associated with, sponsoring or endorsing Wildshard.

### MiniMax-Music3

Copyright (c) 2026 MiniMax. The game shows "Music: MiniMax-Music3" in
its settings, as section 3 of the licence requires. Tracks are trimmed,
looped, loudness-normalized and encoded from the model's output. Each
folder's `music.json` records the takes.

### Stability AI and Gemma

Powered by Stability AI.

This Stability AI Model is licensed under the Stability AI Community
License, Copyright © Stability AI Ltd. All Rights Reserved.

Gemma is provided under and subject to the Gemma Terms of Use found at
ai.google.dev/gemma/terms

Stable Audio 3 Medium uses a T5Gemma text encoder. This repository
holds sounds generated with that model and no Stability AI or Gemma
weights or code. Sounds are trimmed, looped, loudness-normalized and
encoded from the model's output. Each `sfx.json` names the model behind
each sound.

### Fonts

The font files carry these lines in their own metadata:

- Caveat: Copyright 2014 The Caveat Project Authors
  (https://github.com/googlefonts/caveat)
- JetBrains Mono: Copyright 2020 The JetBrains Mono Project Authors
  (https://github.com/JetBrains/JetBrainsMono)
- Rajdhani: Copyright (c) 2014 Indian Type Foundry
  (info@indiantypefoundry.com)

### Rapier and Basis Universal

Rapier: Copyright 2020 Dimforge EURL. `rapier.wasm` is an unmodified
copy of `rapier_wasm3d_bg.wasm` from `@dimforge/rapier3d-simd` 0.21.0.

Basis Universal: Copyright 2019-2026 Binomial LLC. `basis_transcoder.js`
and `basis_transcoder.wasm` are unmodified copies of the build in
`three` 0.186.0, `examples/jsm/libs/basis/`.

Neither is tracked in git here. Both are copied in at build and served
with the game.

### three-freecam

`FreeCam.ts` is three-freecam 0.2.0 by Daniel (hxtnv), rewritten as
strict TypeScript. We added `enabled` gating on every listener and
`look` and `move` inputs for the touch layer.

## Appendix A: Tencent Hunyuan 3D 2.0 Community License Agreement

```text
TENCENT HUNYUAN 3D 2.0 COMMUNITY LICENSE AGREEMENT
Tencent Hunyuan 3D 2.0 Release Date: January 21, 2025
THIS LICENSE AGREEMENT DOES NOT APPLY IN THE EUROPEAN UNION, UNITED KINGDOM AND SOUTH KOREA AND IS EXPRESSLY LIMITED TO THE TERRITORY, AS DEFINED BELOW.
By clicking to agree or by using, reproducing, modifying, distributing, performing or displaying any portion or element of the Tencent Hunyuan 3D 2.0 Works, including via any Hosted Service, You will be deemed to have recognized and accepted the content of this Agreement, which is effective immediately.
1.	DEFINITIONS.
a.	“Acceptable Use Policy” shall mean the policy made available by Tencent as set forth in the Exhibit A.
b.	“Agreement” shall mean the terms and conditions for use, reproduction, distribution, modification, performance and displaying of Tencent Hunyuan 3D 2.0 Works or any portion or element thereof set forth herein.
c.	“Documentation” shall mean the specifications, manuals and documentation for Tencent Hunyuan 3D 2.0 made publicly available by Tencent.
d.	“Hosted Service” shall mean a hosted service offered via an application programming interface (API), web access, or any other electronic or remote means.
e.	“Licensee,” “You” or “Your” shall mean a natural person or legal entity exercising the rights granted by this Agreement and/or using the Tencent Hunyuan 3D 2.0 Works for any purpose and in any field of use.
f.	“Materials” shall mean, collectively, Tencent’s proprietary Tencent Hunyuan 3D 2.0 and Documentation (and any portion thereof) as made available by Tencent under this Agreement.
g.	“Model Derivatives” shall mean all: (i) modifications to Tencent Hunyuan 3D 2.0 or any Model Derivative of Tencent Hunyuan 3D 2.0; (ii) works based on Tencent Hunyuan 3D 2.0 or any Model Derivative of Tencent Hunyuan 3D 2.0; or (iii) any other machine learning model which is created by transfer of patterns of the weights, parameters, operations, or Output of Tencent Hunyuan 3D 2.0 or any Model Derivative of Tencent Hunyuan 3D 2.0, to that model in order to cause that model to perform similarly to Tencent Hunyuan 3D 2.0 or a Model Derivative of Tencent Hunyuan 3D 2.0, including distillation methods, methods that use intermediate data representations, or methods based on the generation of synthetic data Outputs by Tencent Hunyuan 3D 2.0 or a Model Derivative of Tencent Hunyuan 3D 2.0 for training that model. For clarity, Outputs by themselves are not deemed Model Derivatives.
h.	“Output” shall mean the information and/or content output of Tencent Hunyuan 3D 2.0 or a Model Derivative that results from operating or otherwise using Tencent Hunyuan 3D 2.0 or a Model Derivative, including via a Hosted Service.
i.	“Tencent,” “We” or “Us” shall mean the applicable entity or entities in the Tencent corporate family that own(s) intellectual property or other rights embodied in or utilized by the Materials.
*  Section 1.i of the previous Hunyuan License Agreement defined “Tencent,” “We” or “Us” to mean THL A29 Limited, and the copyright notices pertaining to the Materials were previously in the name of “THL A29 Limited.”  That entity has now been de-registered.  You should treat all previously distributed copies of the Materials as if Section 1.i of the Agreement defined “Tencent,” “We” or “Us” to mean “the applicable entity or entities in the Tencent corporate family that own(s) intellectual property or other rights embodied in or utilized by the Materials,” and treat the copyright notice(s) accompanying the Materials as if they were in the name of “Tencent.”  When providing a copy of any Agreement to Third Party recipients of the Tencent Hunyuan Works or products or services using them, as required by Section 3.a of the Agreement, you should provide the most current version of the Agreement, including the change of definition in Section 1.i of the Agreement.
j.	“Tencent Hunyuan 3D 2.0” shall mean the 3D generation models and their software and algorithms, including trained model weights, parameters (including optimizer states), machine-learning model code, inference-enabling code, training-enabling code, fine-tuning enabling code and other elements of the foregoing made publicly available by Us at https://github.com/Tencent/Hunyuan3D-2.
k.	“Tencent Hunyuan 3D 2.0 Works” shall mean: (i) the Materials; (ii) Model Derivatives; and (iii) all derivative works thereof.
l.	“Territory” shall mean the worldwide territory, excluding the territory of the European Union, United Kingdom and South Korea.
m.	“Third Party” or “Third Parties” shall mean individuals or legal entities that are not under common control with Us or You.
n.	“including” shall mean including but not limited to.
2.	GRANT OF RIGHTS.
We grant You, for the Territory only, a non-exclusive, non-transferable and royalty-free limited license under Tencent’s intellectual property or other rights owned by Us embodied in or utilized by the Materials to use, reproduce, distribute, create derivative works of (including Model Derivatives), and make modifications to the Materials, only in accordance with the terms of this Agreement and the Acceptable Use Policy, and You must not violate (or encourage or permit anyone else to violate) any term of this Agreement or the Acceptable Use Policy.
3.	DISTRIBUTION.
You may, subject to Your compliance with this Agreement, distribute or make available to Third Parties the Tencent Hunyuan 3D 2.0 Works, exclusively in the Territory, provided that You meet all of the following conditions:
a.	You must provide all such Third Party recipients of the Tencent Hunyuan 3D 2.0 Works or products or services using them a copy of this Agreement;
b.	You must cause any modified files to carry prominent notices stating that You changed the files;
c.	You are encouraged to: (i) publish at least one technology introduction blogpost or one public statement expressing Your experience of using the Tencent Hunyuan 3D 2.0 Works; and (ii) mark the products or services developed by using the Tencent Hunyuan 3D 2.0 Works to indicate that the product/service is “Powered by Tencent Hunyuan”; and
d.	All distributions to Third Parties (other than through a Hosted Service) must be accompanied by a “Notice” text file that contains the following notice: “Tencent Hunyuan 3D 2.0 is licensed under the Tencent Hunyuan 3D 2.0 Community License Agreement, Copyright © 2025 Tencent. All Rights Reserved. The trademark rights of “Tencent Hunyuan” are owned by Tencent or its affiliate.”
You may add Your own copyright statement to Your modifications and, except as set forth in this Section and in Section 5, may provide additional or different license terms and conditions for use, reproduction, or distribution of Your modifications, or for any such Model Derivatives as a whole, provided Your use, reproduction, modification, distribution, performance and display of the work otherwise complies with the terms and conditions of this Agreement (including as regards the Territory). If You receive Tencent Hunyuan 3D 2.0 Works from a Licensee as part of an integrated end user product, then this Section 3 of this Agreement will not apply to You.
e.  In the event that You use, integrate, implement, or otherwise deploy the Tencent Hunyuan Works, in whole or in part, to provide, enable, or support any service, product, or functionality to third parties, You shall clearly, accurately, and prominently disclose to all end users the full legal name and entity of the actual provider of such service, product, or functionality. You shall expressly and conspicuously state that Tencent is not affiliated with, associated with, sponsoring, or endorsing any such service, product, or functionality. You shall not use or display any name, logo, trademark, trade name, or other indicia of Tencent in any manner that could be construed as, or be likely to create, confusion, deception, or a false impression regarding any relationship, affiliation, sponsorship, or endorsement by Tencent.
4.	ADDITIONAL COMMERCIAL TERMS.
If, on the Tencent Hunyuan 3D 2.0 version release date, the monthly active users of all products or services made available by or for Licensee is greater than 1 million monthly active users in the preceding calendar month, You must request a license from Tencent, which Tencent may grant to You in its sole discretion, and You are not authorized to exercise any of the rights under this Agreement unless or until Tencent otherwise expressly grants You such rights.
Subject to Tencent's written approval, you may request a license for the use of Tencent Hunyuan 3D 2.0 by submitting the following information to hunyuan3d@tencent.com:
a.	Your company’s name and associated business sector that plans to use Tencent Hunyuan 3D 2.0.
b.	Your intended use case and the purpose of using Tencent Hunyuan 3D 2.0.
5.	RULES OF USE.
a.	Your use of the Tencent Hunyuan 3D 2.0 Works must comply with applicable laws and regulations (including trade compliance laws and regulations) and adhere to the Acceptable Use Policy for the Tencent Hunyuan 3D 2.0 Works, which is hereby incorporated by reference into this Agreement. You must include the use restrictions referenced in these Sections 5(a) and 5(b) as an enforceable provision in any agreement (e.g., license agreement, terms of use, etc.) governing the use and/or distribution of Tencent Hunyuan 3D 2.0 Works and You must provide notice to subsequent users to whom You distribute that Tencent Hunyuan 3D 2.0 Works are subject to the use restrictions in these Sections 5(a) and 5(b).
b.	You must not use the Tencent Hunyuan 3D 2.0 Works or any Output or results of the Tencent Hunyuan 3D 2.0 Works to improve any other AI model (other than Tencent Hunyuan 3D 2.0 or Model Derivatives thereof).
c.	You must not use, reproduce, modify, distribute, or display the Tencent Hunyuan 3D 2.0 Works, Output or results of the Tencent Hunyuan 3D 2.0 Works outside the Territory. Any such use outside the Territory is unlicensed and unauthorized under this Agreement.
6.	INTELLECTUAL PROPERTY.
a.	Subject to Tencent’s ownership of Tencent Hunyuan 3D 2.0 Works made by or for Tencent and intellectual property rights therein, conditioned upon Your compliance with the terms and conditions of this Agreement, as between You and Tencent, You will be the owner of any derivative works and modifications of the Materials and any Model Derivatives that are made by or for You.
b.	No trademark licenses are granted under this Agreement, and in connection with the Tencent Hunyuan 3D 2.0 Works, Licensee may not use any name or mark owned by or associated with Tencent or any of its affiliates, except as required for reasonable and customary use in describing and distributing the Tencent Hunyuan 3D 2.0 Works. Tencent hereby grants You a license to use “Tencent Hunyuan” (the “Mark”) in the Territory solely as required to comply with the provisions of Section 3(c), provided that You comply with any applicable laws related to trademark protection. All goodwill arising out of Your use of the Mark will inure to the benefit of Tencent.
c.	If You commence a lawsuit or other proceedings (including a cross-claim or counterclaim in a lawsuit) against Us or any person or entity alleging that the Materials or any Output, or any portion of any of the foregoing, infringe any intellectual property or other right owned or licensable by You, then all licenses granted to You under this Agreement shall terminate as of the date such lawsuit or other proceeding is filed. You will defend, indemnify and hold harmless Us from and against any claim by any Third Party arising out of or related to Your or the Third Party’s use or distribution of the Tencent Hunyuan 3D 2.0 Works.
d.	Tencent claims no rights in Outputs You generate. You and Your users are solely responsible for Outputs and their subsequent uses.
7.	DISCLAIMERS OF WARRANTY AND LIMITATIONS OF LIABILITY.
a.	We are not obligated to support, update, provide training for, or develop any further version of the Tencent Hunyuan 3D 2.0 Works or to grant any license thereto.
b.	UNLESS AND ONLY TO THE EXTENT REQUIRED BY APPLICABLE LAW, THE TENCENT HUNYUAN 3D 2.0 WORKS AND ANY OUTPUT AND RESULTS THEREFROM ARE PROVIDED “AS IS” WITHOUT ANY EXPRESS OR IMPLIED WARRANTIES OF ANY KIND INCLUDING ANY WARRANTIES OF TITLE, MERCHANTABILITY, NONINFRINGEMENT, COURSE OF DEALING, USAGE OF TRADE, OR FITNESS FOR A PARTICULAR PURPOSE. YOU ARE SOLELY RESPONSIBLE FOR DETERMINING THE APPROPRIATENESS OF USING, REPRODUCING, MODIFYING, PERFORMING, DISPLAYING OR DISTRIBUTING ANY OF THE TENCENT HUNYUAN 3D 2.0 WORKS OR OUTPUTS AND ASSUME ANY AND ALL RISKS ASSOCIATED WITH YOUR OR A THIRD PARTY’S USE OR DISTRIBUTION OF ANY OF THE TENCENT HUNYUAN 3D 2.0 WORKS OR OUTPUTS AND YOUR EXERCISE OF RIGHTS AND PERMISSIONS UNDER THIS AGREEMENT.
c.	TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL TENCENT OR ITS AFFILIATES BE LIABLE UNDER ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, TORT, NEGLIGENCE, PRODUCTS LIABILITY, OR OTHERWISE, FOR ANY DAMAGES, INCLUDING ANY DIRECT, INDIRECT, SPECIAL, INCIDENTAL, EXEMPLARY, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR LOST PROFITS OF ANY KIND ARISING FROM THIS AGREEMENT OR RELATED TO ANY OF THE TENCENT HUNYUAN 3D 2.0 WORKS OR OUTPUTS, EVEN IF TENCENT OR ITS AFFILIATES HAVE BEEN ADVISED OF THE POSSIBILITY OF ANY OF THE FOREGOING.
8.	SURVIVAL AND TERMINATION.
a.	The term of this Agreement shall commence upon Your acceptance of this Agreement or access to the Materials and will continue in full force and effect until terminated in accordance with the terms and conditions herein.
b.	We may terminate this Agreement if You breach any of the terms or conditions of this Agreement. Upon termination of this Agreement, You must promptly delete and cease use of the Tencent Hunyuan 3D 2.0 Works. Sections 6(a), 6(c), 7 and 9 shall survive the termination of this Agreement.
9.	GOVERNING LAW AND JURISDICTION.
a.	This Agreement and any dispute arising out of or relating to it will be governed by the laws of the Hong Kong Special Administrative Region of the People’s Republic of China, without regard to conflict of law principles, and the UN Convention on Contracts for the International Sale of Goods does not apply to this Agreement.
b.	Exclusive jurisdiction and venue for any dispute arising out of or relating to this Agreement will be a court of competent jurisdiction in the Hong Kong Special Administrative Region of the People’s Republic of China, and Tencent and Licensee consent to the exclusive jurisdiction of such court with respect to any such dispute.

EXHIBIT A
ACCEPTABLE USE POLICY

Tencent reserves the right to update this Acceptable Use Policy from time to time.
Last modified: November 5, 2024

Tencent endeavors to promote safe and fair use of its tools and features, including Tencent Hunyuan 3D 2.0. You agree not to use Tencent Hunyuan 3D 2.0 or Model Derivatives:
1.	Outside the Territory;
2.	In any way that violates any applicable national, federal, state, local, international or any other law or regulation;
3.	To harm Yourself or others;
4.	To repurpose or distribute output from Tencent Hunyuan 3D 2.0 or any Model Derivatives to harm Yourself or others;
5.	To override or circumvent the safety guardrails and safeguards We have put in place;
6.	For the purpose of exploiting, harming or attempting to exploit or harm minors in any way;
7.	To generate or disseminate verifiably false information and/or content with the purpose of harming others or influencing elections;
8.	To generate or facilitate false online engagement, including fake reviews and other means of fake online engagement;
9.	To intentionally defame, disparage or otherwise harass others;
10.	To generate and/or disseminate malware (including ransomware) or any other content to be used for the purpose of harming electronic systems;
11.	To generate or disseminate personal identifiable information with the purpose of harming others;
12.	To generate or disseminate information (including images, code, posts, articles), and place the information in any public context (including –through the use of bot generated tweets), without expressly and conspicuously identifying that the information and/or content is machine generated;
13.	To impersonate another individual without consent, authorization, or legal right;
14.	To make high-stakes automated decisions in domains that affect an individual’s safety, rights or wellbeing (e.g., law enforcement, migration, medicine/health, management of critical infrastructure, safety components of products, essential services, credit, employment, housing, education, social scoring, or insurance);
15.	In a manner that violates or disrespects the social ethics and moral standards of other countries or regions;
16.	To perform, facilitate, threaten, incite, plan, promote or encourage violent extremism or terrorism;
17.	For any use intended to discriminate against or harm individuals or groups based on protected characteristics or categories, online or offline social behavior or known or predicted personal or personality characteristics;
18.	To intentionally exploit any of the vulnerabilities of a specific group of persons based on their age, social, physical or mental characteristics, in order to materially distort the behavior of a person pertaining to that group in a manner that causes or is likely to cause that person or another person physical or psychological harm;
19.	For military purposes;
20.	To engage in the unauthorized or unlicensed practice of any profession including, but not limited to, financial, legal, medical/health, or other professional practices.
```

## Appendix B: MiniMax-Music3 Community License

```text
MiniMax-Music3 COMMUNITY LICENSE

Copyright (c) 2026 MiniMax

Permission is hereby granted, free of charge, to any person obtaining a copy of this Software,
including the model weights, parameters, configuration files, inference code and associated
documentation (the “Software”), to deal in the Software, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or provide copies of the Software,
and to permit persons to whom the Software is furnished to do so, subject to the following
conditions:

1. The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

2. Your use of the Software must comply with applicable laws and regulations (including
trade-compliance laws and regulations) and must comply with the Acceptable Use Policy in Exhibit A.
Especially, you must not violate any third party’s intellectual-property or other rights while using
the Software.

3. Commercial Terms

    1. You shall prominently display “MiniMax-Music3” on the user interface of commercial product or
    service that uses the Software.

    2. You shall obtain a separate, prior written authorization from MiniMax by contacting
    api@minimax.io with the subject line “MiniMax-Music3 licensing - authorization request”, if the
    aggregate yearly revenue generated from such products and services provided by you and/or any of
    your affiliates exceeds 20 million US dollars (or equivalent in other currencies).

4. If you provide or make available to any third party a product, service, or hosted service that
permits the generation of outputs using the Software, you must, before making that product or
service available and throughout its operation, implement, maintain, test, and periodically review
reasonable and proportionate technical and organizational safeguards designed to prevent and
mitigate access, uses, and outputs that violate this License, including uses or outputs that
infringe, misappropriate, or otherwise violate any third party’s intellectual-property or other
rights. You must not knowingly disable, materially weaken, or permit the circumvention of those
safeguards. You are responsible for implementing and enforcing these requirements with respect to
your products, services, systems, users, and downstream recipients.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. YOU SHALL BE SOLELY
RESPONSIBLE FOR DETERMINING THE APPROPRIATENESS OF USING, REPRODUCING, MODIFYING, PERFORMING,
DISPLAYING OR DISTRIBUTING ANY OF THE SOFTWARE OR OUTPUTS AND ASSUME ANY AND ALL RISKS ASSOCIATED
WITH YOUR OR A THIRD PARTY’S USE OR DISTRIBUTION OF ANY OF THE SOFTWARE OR OUTPUTS AND YOUR EXERCISE
OF RIGHTS AND PERMISSIONS UNDER THIS LICENSE. YOU SHALL INDEMNIFY AND HOLD HARMLESS MINIMAX FROM AND
AGAINST ANY AND ALL LOSSES, LIABILITIES, DAMAGES, CLAIMS, COSTS, AND EXPENSES ARISING OUT OF OR
RELATING TO ANY OF YOUR BREACH OF THIS LICENSE.

Please note that MiniMax-Music3 was fine-tuned from Qwen3-8B (https://huggingface.co/Qwen/Qwen3-8B),
which is licensed under the Apache License 2.0
(https://huggingface.co/Qwen/Qwen3-8B/blob/main/LICENSE). DiT-2B was modified from the  Stable Audio
code (https://github.com/Stability-AI/stable-audio-tools), which is licensed under the MIT License
(https://github.com/Stability-AI/stable-audio-tools/blob/main/LICENSE). The VAE was modified from
the DAC code (https://github.com/descriptinc/descript-audio-codec), which is licensed under the MIT
License (https://github.com/descriptinc/descript-audio-codec/blob/main/LICENSE).

Exhibit A — Acceptable Use Policy

MiniMax reserves the right to update this Acceptable Use Policy from time to time.

Last revised: August [6], 2026.

MiniMax is committed to promoting the safe and responsible use of its tools and features. You agree
not to use the Software and in any of the following ways:

1. Use in any manner that violates any applicable national, federal, state, local, or international
law, regulation, or other legal requirement, or that infringes, misappropriates, or otherwise
violates any third party’s intellectual-property or other proprietary rights, including without
limitation, through unauthorized reproduction, distribution, public display, public performance, or
creation of derivative works;

2. Use in any manner that may harm yourself or others;

3. Use to generate, repurpose or distribute any content to harm yourself or others;

4. Use to circumvent or bypass any safety guardrails or safeguards we have implemented;

5. Use in any manner that exploits or harms, or intends to exploit or harm, minors;

6. Use to generate or disseminate verifiably false information and/or content for the purpose of
harming others or influencing elections;

7. Use to manufacture or facilitate false online engagement, including fake reviews and other means
of false online engagement;

8. Use to intentionally defame, disparage, or otherwise harass others;

9. Use to generate and/or disseminate malware (including ransomware) or any other content intended
to damage electronic systems;

10. Use to generate or disseminate personally identifiable information for the purpose of harming
others;

11. Use to generate or disseminate information (including images, code, posts, or articles) in or to
any public environment (including via bot tweets or similar means) without clearly and prominently
disclosing that such information and/or content is machine-generated;

12. Use to impersonate another person without that person’s consent, authorization, or lawful right
to do so;

13. Use to make high-risk automated decisions in critical domains that affect individual safety,
rights, or well-being (such as law enforcement, immigration, healthcare or medical services,
critical-infrastructure management, product-safety components, essential services, credit,
employment, housing, education, social scoring, or insurance);

14. Use in any manner that violates or disregards the social, ethical, or moral standards of other
countries or regions;

15. Use to carry out, assist, threaten, incite, plan, advocate for, or encourage violent extremism
or terrorism;

16. Use for any purpose intended to discriminate against, or harm, individuals or groups based on
protected characteristics or categories, online or offline social behavior, or known or predicted
personality traits;

17. Use to intentionally exploit the vulnerabilities of specific populations based on age, social,
physical, or psychological characteristics, so as to materially distort the behavior of a member of
that group in a manner that causes, or is likely to cause, physical or psychological harm to that
person or to others;

18. Use for military purposes; and

19. Use to engage in any unauthorized or unlicensed professional activity, including but not limited
to financial, legal, medical or healthcare, or other professional practice.
```

## Appendix C: Stability AI Community License Agreement

Copied from <https://stability.ai/community-license-agreement> on
2026-11-07.

```text
Community License Agreement
Last Updated: July 5, 2024
I. INTRODUCTION
This Agreement applies to any individual person or entity (“You”, “Your” or “Licensee”) that uses or distributes any portion or element of the Stability AI Materials or Derivative Works thereof for any Research & Non-Commercial or Commercial purpose. Capitalized terms not otherwise defined herein are defined in Section IV below.
This Agreement is intended to allow research, non-commercial, and limited commercial uses of the Models free of charge. In order to ensure that certain limited commercial uses of the Models continue to be allowed, this Agreement  preserves free access to the Models for people or organizations  generating annual revenue of less than US $1,000,000 (or local currency equivalent).
By clicking “I Accept” or by using or distributing or using any portion or element of the Stability Materials or Derivative Works, You agree that You have read, understood and are bound by the terms of this Agreement. If You are acting on behalf of a company, organization or other entity, then “You” includes you and that entity, and You agree that You: (i) are an authorized representative of such entity with the authority to bind such entity to this Agreement, and (ii) You agree to the terms of this Agreement on that entity’s behalf.
II. RESEARCH & NON-COMMERCIAL USE LICENSE
Subject to the terms of this Agreement, Stability AI grants You a non-exclusive, worldwide, non-transferable, non-sublicensable, revocable and royalty-free limited license under Stability AI’s intellectual property or other rights owned by Stability AI embodied in the Stability AI Materials to use, reproduce, distribute, and create Derivative Works of, and make modifications to, the Stability AI Materials for any Research or Non-Commercial Purpose. “Research Purpose” means academic or scientific advancement, and in each case, is not primarily intended for commercial advantage or monetary compensation to You or others. “Non-Commercial Purpose” means any purpose other than a Research Purpose that is not primarily intended for commercial advantage or monetary compensation to You or others, such as personal use (i.e., hobbyist) or evaluation and testing.
III. COMMERCIAL USE LICENSE
Subject to the terms of this Agreement (including the remainder of this Section III), Stability AI grants You a non-exclusive, worldwide, non-transferable, non-sublicensable, revocable and royalty-free limited license under Stability AI’s intellectual property or other rights owned by Stability AI embodied in the Stability AI Materials to use, reproduce, distribute, and create Derivative Works of, and make modifications to, the Stability AI Materials for any Commercial Purpose. “Commercial Purpose” means any purpose other than a Research Purpose or Non-Commercial Purpose that is primarily intended for commercial advantage or monetary compensation to You or others, including but not limited to, (i) creating, modifying, or distributing Your product or service, including via a hosted service or application programming interface, and (ii) for Your business’s or organization’s internal operations.
If You are using or distributing the Stability AI Materials for a Commercial Purpose, You must register with Stability AI. If at any time You or Your Affiliate(s), either individually or in aggregate, generate more than USD $1,000,000 in annual revenue (or the equivalent thereof in Your local currency), regardless of whether that revenue is generated directly or indirectly from the Stability AI Materials or Derivative Works, any licenses granted to You under this Agreement shall terminate as of such date. You must request a license from Stability AI, which Stability AI may grant to You in its sole discretion. If you receive Stability AI Materials, or any Derivative Works thereof, from a Licensee as part of an integrated end user product, then Section III of this Agreement will not apply to you.
IV. GENERAL TERMS
Your Research, Non-Commercial, and Commercial License(s) under this Agreement are subject to the following terms.
a.  Distribution & Attribution. If You distribute or make available the Stability AI Materials or a Derivative Work to a third party, or a product or service that uses any portion of them, You shall: (i) provide a copy of this Agreement to that third party, (ii) retain the following attribution notice within a "Notice" text file distributed as a part of such copies: "This Stability AI Model is licensed under the Stability AI Community License, Copyright ©  Stability AI Ltd. All Rights Reserved”, and (iii) prominently display “Powered by Stability AI” on a related website, user interface, blogpost, about page, or product documentation.  If You create a Derivative Work, You may add your own attribution notice(s) to the “Notice” text file included with that Derivative Work, provided that You clearly indicate which attributions apply to the Stability AI Materials and state in the “Notice” text file that You changed the Stability AI Materials and how it was modified.
b.   Use Restrictions. Your use of the Stability AI Materials and Derivative Works, including any output or results of the Stability AI Materials or Derivative Works, must comply with applicable laws and regulations (including Trade Control Laws and equivalent regulations) and adhere to the Documentation and Stability AI’s AUP, which is hereby incorporated by reference. Furthermore, You will not use the Stability AI Materials or Derivative Works, or any output or results of the Stability AI Materials or Derivative Works, to create or improve any foundational generative AI model (excluding the Models or Derivative Works).
c. Intellectual Property.
(i) Trademark License.  No trademark licenses are granted under this Agreement, and in connection with the Stability AI Materials or Derivative Works, You may not use any name or mark owned by or associated with Stability AI or any of its Affiliates, except as required under Section IV(a) herein.
(ii) Ownership of Derivative Works.  As between You and Stability AI, You are the owner of Derivative Works You create, subject to Stability AI’s ownership of the Stability AI Materials and any Derivative Works made by or for Stability AI.
(iii) Ownership of Outputs. As between You and Stability AI, You own any outputs generated from the Models or Derivative Works to the extent permitted by applicable law.
(iv)  Disputes.  If You or Your Affiliate(s) institute litigation or other proceedings against Stability AI (including a cross-claim or counterclaim in a lawsuit) alleging that the Stability AI Materials, Derivative Works or associated outputs or results, or any portion of any of the foregoing, constitutes infringement of intellectual property or other rights owned or licensable by You, then any licenses granted to You under this Agreement shall terminate as of the date such litigation or claim is filed or instituted. You will indemnify and hold harmless Stability AI from and against any claim by any third party arising out of or related to Your use or distribution of the Stability AI Materials or Derivative Works in violation of this Agreement.
(v) Feedback.  From time to time, You may provide Stability AI with verbal and/or written suggestions, comments or other feedback related to Stability AI’s existing or prospective technology, products or services (collectively, “Feedback”). You are not obligated to provide Stability AI with Feedback, but to the extent that You do, You hereby grant Stability AI a perpetual, irrevocable, royalty-free, fully-paid, sub-licensable, transferable, non-exclusive, worldwide right and license to exploit the Feedback in any manner without restriction. Your Feedback is provided “AS IS” and You make no warranties whatsoever about any Feedback.
d.   Disclaimer Of Warranty. UNLESS REQUIRED BY APPLICABLE LAW, THE STABILITY AI MATERIALS AND ANY OUTPUT AND RESULTS THEREFROM ARE PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING, WITHOUT LIMITATION, ANY WARRANTIES OF TITLE, NON-INFRINGEMENT, MERCHANTABILITY, OR FITNESS FOR A PARTICULAR PURPOSE. YOU ARE SOLELY RESPONSIBLE FOR DETERMINING THE APPROPRIATENESS OR LAWFULNESS OF USING OR REDISTRIBUTING THE STABILITY AI MATERIALS, DERIVATIVE WORKS OR ANY OUTPUT OR RESULTS AND ASSUME ANY RISKS ASSOCIATED WITH YOUR USE OF THE STABILITY AI MATERIALS, DERIVATIVE WORKS AND ANY OUTPUT AND RESULTS.
e.  Limitation Of Liability. IN NO EVENT WILL STABILITY AI OR ITS AFFILIATES BE LIABLE UNDER ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, TORT, NEGLIGENCE, PRODUCTS LIABILITY, OR OTHERWISE, ARISING OUT OF THIS AGREEMENT, FOR ANY LOST PROFITS OR ANY DIRECT, INDIRECT, SPECIAL, CONSEQUENTIAL, INCIDENTAL, EXEMPLARY OR PUNITIVE DAMAGES, EVEN IF STABILITY AI OR ITS AFFILIATES HAVE BEEN ADVISED OF THE POSSIBILITY OF ANY OF THE FOREGOING.
f. Term And Termination. The term of this Agreement will commence upon Your acceptance of this Agreement or access to the Stability AI Materials and will continue in full force and effect until terminated in accordance with the terms and conditions herein. Stability AI may terminate this Agreement if You are in breach of any term or condition of this Agreement. Upon termination of this Agreement, You shall delete and cease use of any Stability AI Materials or Derivative Works. Section IV(d), (e), and (g) shall survive the termination of this Agreement.
g. Governing Law.  This Agreement will be governed by and constructed in accordance with the laws of the United States and the State of California without regard to choice of law principles, and the UN Convention on Contracts for International Sale of Goods does not apply to this Agreement.
V. DEFINITIONS
“Affiliate(s)” means any entity that directly or indirectly controls, is controlled by, or is under common control with the subject entity; for purposes of this definition, “control” means direct or indirect ownership or control of more than 50% of the voting interests of the subject entity.
"Agreement" means this Stability AI Community License Agreement.
“AUP” means the Stability AI Acceptable Use Policy available at https://stability.ai/use-policy, as may be updated from time to time.
"Derivative Work(s)” means (a) any derivative work of the Stability AI Materials as recognized by U.S. copyright laws and (b) any modifications to a Model, and any other model created which is based on or derived from the Model or the Model’s output, including“fine tune” and “low-rank adaptation” models derived from a Model or a Model’s output, but do not include the output of any Model.
“Documentation” means any specifications, manuals, documentation, and other written information provided by Stability AI related to the Software or Models.
“Model(s)" means, collectively, Stability AI’s proprietary models and algorithms, including machine-learning models, trained model weights and other elements of the foregoing listed on Stability’s Core Models Webpage available at, https://stability.ai/core-models, as may be updated from time to time.
"Stability AI" or "we" means Stability AI Ltd. and its Affiliates.
"Software" means Stability AI’s proprietary software made available under this Agreement now or in the future.
“Stability AI Materials” means, collectively, Stability’s proprietary Models, Software and Documentation (and any portion or combination thereof) made available under this Agreement.
“Trade Control Laws” means any applicable U.S. and non-U.S. export control and trade sanctions laws and regulations.
```

## Appendix D: SIL Open Font License 1.1

```text
This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## Appendix E: Apache License 2.0

As shipped in `@dimforge/rapier3d-simd`. Basis Universal uses the same
terms, under its own copyright line above.

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright 2020 Dimforge EURL

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

## Appendix F: Basis Universal NOTICE

Copied from `BinomialLLC/basis_universal` `master` on 2026-11-07.

```text
NOTICE

Basis Universal™ Supercompressed GPU Texture Compression Library

Copyright © 2016–2026 Binomial LLC.
All rights reserved except as granted under the [Apache 2.0 license](https://github.com/BinomialLLC/basis_universal/blob/master/LICENSE).
"Basis Universal" is a trademark of Binomial LLC.

The documents in the Basis Universal wiki, and the Basis Universal library, example, and tool source code, fall under the Apache 2.0 license, unless otherwise explicitly indicated.

Redistributions or derivative works must include a readable copy of the attribution notices from this NOTICE file (see Apache License 2.0 §4(d)).

If you modify the Basis Universal source code, specifications, or wiki documents and redistribute the files, you must cause any modified files to carry prominent notices stating that you changed the files (see Apache 2.0 §4(b)).

**This software, documentation and specifications are provided "as is", without warranty of any kind (see Apache 2.0 §§7–8).**
```

## Appendix G: MIT License for three-freecam

```text
MIT License

Copyright (c) 2026 Daniel (hxtnv)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
