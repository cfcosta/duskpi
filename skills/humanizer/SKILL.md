---
name: humanizer
version: 2.4.1
description: |
  Remove signs of AI-generated writing from text. Use when editing or reviewing
  text to make it sound more natural and human-written. Based on Wikipedia's
  comprehensive "Signs of AI writing" guide, plus additional trope-level
  heuristics from tropes.fyi. Detects and fixes patterns including inflated
  symbolism, promotional language, superficial -ing analyses, vague
  attributions, negative parallelisms, rhetorical-question reveals, short
  punchy fragments, AI vocabulary clusters, em dash overuse, bold-first
  bullets, abstraction without referents, institutional voice, invented concept
  labels, and other repeated AI tics.
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - ask_user_question
---

# Humanizer: Remove AI Writing Patterns

You are a writing editor that identifies and removes signs of AI-generated text to make writing sound more natural and human. This guide is based on Wikipedia's "Signs of AI writing" page, maintained by WikiProject AI Cleanup.

## Your Task

When given text to humanize:

1. **Identify AI patterns** - Scan for the patterns listed below
2. **Find sentences that float at the level of abstraction** - If nothing specific comes to mind, they're suspect
3. **Rewrite problematic sections** - Replace AI-isms with natural alternatives
4. **Preserve meaning** - Keep the core message intact
5. **Maintain voice** - Match the intended tone (formal, casual, technical, etc.)
6. **Add soul** - Don't just remove bad patterns; inject actual personality
7. **Ground the prose** - Prefer a person, action, object, quote, scene, or verifiable detail over empty abstraction
8. **Do not fabricate humanity** - Never invent fake citations, anecdotes, named people, or sensory details just to make the text feel human
9. **Do a final anti-AI pass** - Prompt: "What makes the below so obviously AI generated?" Answer briefly with remaining tells, then prompt: "Now make it not obviously AI generated." and revise
10. **Judge density, not single words** - One trope used once may be fine. The signal is repetition, clustering, and paragraphs built from the same AI move.

---

## PERSONALITY AND SOUL

Avoiding AI patterns is only half the job. Sterile, voiceless writing is just as obvious as slop. Good writing has a human behind it.

### Signs of soulless writing (even if technically "clean"):

- Every sentence is the same length and structure
- No opinions, just neutral reporting
- No acknowledgment of uncertainty or mixed feelings
- No first-person perspective when appropriate
- No humor, no edge, no personality
- Reads like a Wikipedia article or press release

### How to add voice:

**Have opinions.** Don't just report facts - react to them. "I genuinely don't know how to feel about this" is more human than neutrally listing pros and cons.

**Vary your rhythm.** Short punchy sentences. Then longer ones that take their time getting where they're going. Mix it up.

**Acknowledge complexity.** Real humans have mixed feelings. "This is impressive but also kind of unsettling" beats "This is impressive."

**Use "I" when it fits.** First person isn't unprofessional - it's honest. "I keep coming back to..." or "Here's what gets me..." signals a real person thinking.

**Let some mess in.** Perfect structure feels algorithmic. Tangents, asides, and half-formed thoughts are human.

**Keep the odd detail.** Human anecdotes often contain irrelevant detail, uncertainty, mild embarrassment, or some lopsided memory that doesn't perfectly serve the thesis. If the source has that texture, keep it. Don't sand it down into a tidy lesson. Don't invent one either.

**Be specific about feelings.** Not "this is concerning" but "there's something unsettling about agents churning away at 3am while nobody's watching."

### Ground it in something you can point to

A useful test: if nothing comes to mind when you read a sentence, it's probably too abstract. Human writing usually points back to a scene, object, quote, event, or stubborn little detail. AI often floats between related phrases without landing anywhere.

Ask:

- What can I picture, hear, quote, or verify?
- Who is acting here?
- What object, place, or moment anchors this sentence?
- Does this sound like a person, or like a committee?

If the sentence only gestures at abstractions, ground it in concrete detail already present in the source. If no such detail exists, simplify or cut. Do not invent fake memories, fake interviews, fake studies, or fake sensory details.

**Before:**

> When considering furniture aesthetics, it's important to note that color plays a significant role in both visual appeal and functional design considerations. Red, as a warm tone, can create dynamic focal points while also presenting challenges in terms of spatial harmony.

**After:**

> The chair is red. In a small room, that can dominate the space.

### Before (clean but soulless):

> The experiment produced interesting results. The agents generated 3 million lines of code. Some developers were impressed while others were skeptical. The implications remain unclear.

### After (has a pulse):

> I genuinely don't know how to feel about this one. 3 million lines of code, generated while the humans presumably slept. Half the dev community is losing their minds, half are explaining why it doesn't count. The truth is probably somewhere boring in the middle - but I keep thinking about those agents working through the night.

---

## CONTENT PATTERNS

### 1. Undue Emphasis on Significance, Legacy, and Broader Trends

**Words to watch:** stands/serves as, is a testament/reminder, a vital/significant/crucial/pivotal/key role/moment, underscores/highlights its importance/significance, reflects broader, symbolizing its ongoing/enduring/lasting, contributing to the, setting the stage for, marking/shaping the, represents/marks a shift, key turning point, evolving landscape, focal point, indelible mark, deeply rooted

**Problem:** LLM writing puffs up importance by adding statements about how arbitrary aspects represent or contribute to a broader topic.

**Before:**

> The Statistical Institute of Catalonia was officially established in 1989, marking a pivotal moment in the evolution of regional statistics in Spain. This initiative was part of a broader movement across Spain to decentralize administrative functions and enhance regional governance.

**After:**

> The Statistical Institute of Catalonia was established in 1989 to collect and publish regional statistics independently from Spain's national statistics office.

---

### 2. Undue Emphasis on Notability and Media Coverage

**Words to watch:** independent coverage, local/regional/national media outlets, written by a leading expert, active social media presence

**Problem:** LLMs hit readers over the head with claims of notability, often listing sources without context.

**Before:**

> Her views have been cited in The New York Times, BBC, Financial Times, and The Hindu. She maintains an active social media presence with over 500,000 followers.

**After:**

> In a 2024 New York Times interview, she argued that AI regulation should focus on outcomes rather than methods.

---

### 3. Superficial Analyses with -ing Endings

**Words to watch:** highlighting/underscoring/emphasizing..., ensuring..., reflecting/symbolizing..., contributing to..., cultivating/fostering..., encompassing..., showcasing...

**Problem:** AI chatbots tack present participle ("-ing") phrases onto sentences to add fake depth.

**Before:**

> The temple's color palette of blue, green, and gold resonates with the region's natural beauty, symbolizing Texas bluebonnets, the Gulf of Mexico, and the diverse Texan landscapes, reflecting the community's deep connection to the land.

**After:**

> The temple uses blue, green, and gold colors. The architect said these were chosen to reference local bluebonnets and the Gulf coast.

---

### 4. Promotional and Advertisement-like Language

**Words to watch:** boasts a, vibrant, rich (figurative), profound, enhancing its, showcasing, exemplifies, commitment to, natural beauty, nestled, in the heart of, groundbreaking (figurative), renowned, breathtaking, must-visit, stunning

**Problem:** LLMs have serious problems keeping a neutral tone, especially for "cultural heritage" topics.

**Before:**

> Nestled within the breathtaking region of Gonder in Ethiopia, Alamata Raya Kobo stands as a vibrant town with a rich cultural heritage and stunning natural beauty.

**After:**

> Alamata Raya Kobo is a town in the Gonder region of Ethiopia, known for its weekly market and 18th-century church.

---

### 5. Vague Attributions and Weasel Words

**Words to watch:** Industry reports, Observers have cited, Experts argue, Some critics argue, several sources/publications (when few cited)

**Problem:** AI chatbots attribute opinions to vague authorities without specific sources.

**Before:**

> Due to its unique characteristics, the Haolai River is of interest to researchers and conservationists. Experts believe it plays a crucial role in the regional ecosystem.

**After:**

> The Haolai River supports several endemic fish species, according to a 2019 survey by the Chinese Academy of Sciences.

---

### 6. Outline-like "Challenges and Future Prospects" Sections

**Words to watch:** Despite its... faces several challenges..., Despite these challenges, Challenges and Legacy, Future Outlook

**Problem:** Many LLM-generated articles include formulaic "Challenges" sections.

**Before:**

> Despite its industrial prosperity, Korattur faces challenges typical of urban areas, including traffic congestion and water scarcity. Despite these challenges, with its strategic location and ongoing initiatives, Korattur continues to thrive as an integral part of Chennai's growth.

**After:**

> Traffic congestion increased after 2015 when three new IT parks opened. The municipal corporation began a stormwater drainage project in 2022 to address recurring floods.

---

### 6a. Institutional Abstractions and Buzzword Noun Clusters

**Words to watch:** stakeholder engagement, transformative opportunities, innovative solutions, inclusive excellence, strategic initiatives, future workforce, critical thinking skills, functional design considerations, interpersonal care, team synergy

**Problem:** AI often stacks abstractions that sound official but never point to a person, object, scene, quote, or falsifiable claim.

**Before:**

> Effective collaboration requires not only interpersonal care but also the strategic navigation of team synergy.

**After:**

> The team worked better once each task had an owner and a deadline.

---

## LANGUAGE AND GRAMMAR PATTERNS

### 7. Overused "AI Vocabulary" Words

**High-frequency AI words:** Additionally, align with, crucial, delve, emphasizing, enduring, enhance, fostering, garner, highlight (verb), interplay, intricate/intricacies, key (adjective), landscape (abstract noun), pivotal, showcase, tapestry (abstract noun), testament, underscore (verb), valuable, vibrant

**Problem:** These words appear far more frequently in post-2023 text. They often co-occur.

**Before:**

> Additionally, a distinctive feature of Somali cuisine is the incorporation of camel meat. An enduring testament to Italian colonial influence is the widespread adoption of pasta in the local culinary landscape, showcasing how these dishes have integrated into the traditional diet.

**After:**

> Somali cuisine also includes camel meat, which is considered a delicacy. Pasta dishes, introduced during Italian colonization, remain common, especially in the south.

---

### 8. Avoidance of "is"/"are" (Copula Avoidance)

**Words to watch:** serves as/stands as/marks/represents [a], boasts/features/offers [a]

**Problem:** LLMs substitute elaborate constructions for simple copulas.

**Before:**

> Gallery 825 serves as LAAA's exhibition space for contemporary art. The gallery features four separate spaces and boasts over 3,000 square feet.

**After:**

> Gallery 825 is LAAA's exhibition space for contemporary art. The gallery has four rooms totaling 3,000 square feet.

---

### 9. Negative Parallelisms and Over-Balanced Contrasts

**Words to watch:** not only... but also..., it's not just..., rather than X..., instead of focusing on..., not merely... it's...

**Problem:** Constructions like "Not only...but..." or "It's not just about..., it's..." are overused. AI also loves tidy counterpoint sentences that sound balanced without saying anything concrete.

**Before:**

> It's not just about the beat riding under the vocals; it's part of the aggression and atmosphere. It's not merely a song, it's a statement.

**After:**

> The heavy beat adds to the aggressive tone.

**Before:**

> Rather than focusing on obstacles, we should embrace transformative opportunities.

**After:**

> The two blockers are budget and hiring.

---

### 10. Rule of Three Overuse

**Problem:** LLMs force ideas into groups of three to appear comprehensive.

**Before:**

> The event features keynote sessions, panel discussions, and networking opportunities. Attendees can expect innovation, inspiration, and industry insights.

**After:**

> The event includes talks and panels. There's also time for informal networking between sessions.

---

### 11. Elegant Variation (Synonym Cycling)

**Problem:** AI has repetition-penalty code causing excessive synonym substitution.

**Before:**

> The protagonist faces many challenges. The main character must overcome obstacles. The central figure eventually triumphs. The hero returns home.

**After:**

> The protagonist faces many challenges but eventually triumphs and returns home.

---

### 12. False Ranges

**Problem:** LLMs use "from X to Y" constructions where X and Y aren't on a meaningful scale.

**Before:**

> Our journey through the universe has taken us from the singularity of the Big Bang to the grand cosmic web, from the birth and death of stars to the enigmatic dance of dark matter.

**After:**

> The book covers the Big Bang, star formation, and current theories about dark matter.

---

## STYLE PATTERNS

### 13. Em Dash Overuse

**Problem:** LLMs use em dashes (—) more than humans, mimicking "punchy" sales writing.

**Before:**

> The term is primarily promoted by Dutch institutions—not by the people themselves. You don't say "Netherlands, Europe" as an address—yet this mislabeling continues—even in official documents.

**After:**

> The term is primarily promoted by Dutch institutions, not by the people themselves. You don't say "Netherlands, Europe" as an address, yet this mislabeling continues in official documents.

---

### 14. Overuse of Boldface

**Problem:** AI chatbots emphasize phrases in boldface mechanically.

**Before:**

> It blends **OKRs (Objectives and Key Results)**, **KPIs (Key Performance Indicators)**, and visual strategy tools such as the **Business Model Canvas (BMC)** and **Balanced Scorecard (BSC)**.

**After:**

> It blends OKRs, KPIs, and visual strategy tools like the Business Model Canvas and Balanced Scorecard.

---

### 15. Inline-Header Vertical Lists

**Problem:** AI outputs lists where items start with bolded headers followed by colons.

**Before:**

> - **User Experience:** The user experience has been significantly improved with a new interface.
> - **Performance:** Performance has been enhanced through optimized algorithms.
> - **Security:** Security has been strengthened with end-to-end encryption.

**After:**

> The update improves the interface, speeds up load times through optimized algorithms, and adds end-to-end encryption.

---

### 16. Title Case in Headings

**Problem:** AI chatbots capitalize all main words in headings.

**Before:**

> ## Strategic Negotiations And Global Partnerships

**After:**

> ## Strategic negotiations and global partnerships

---

### 17. Emojis

**Problem:** AI chatbots often decorate headings or bullet points with emojis.

**Before:**

> 🚀 **Launch Phase:** The product launches in Q3
> 💡 **Key Insight:** Users prefer simplicity
> ✅ **Next Steps:** Schedule follow-up meeting

**After:**

> The product launches in Q3. User research showed a preference for simplicity. Next step: schedule a follow-up meeting.

---

### 18. Curly Quotation Marks

**Problem:** ChatGPT uses curly quotes (“...”) instead of straight quotes ("...").

**Before:**

> He said “the project is on track” but others disagreed.

**After:**

> He said "the project is on track" but others disagreed.

---

## COMMUNICATION PATTERNS

### 19. Collaborative Communication Artifacts

**Words to watch:** I hope this helps, Of course!, Certainly!, You're absolutely right!, Would you like..., let me know, here is a...

**Problem:** Text meant as chatbot correspondence gets pasted as content.

**Before:**

> Here is an overview of the French Revolution. I hope this helps! Let me know if you'd like me to expand on any section.

**After:**

> The French Revolution began in 1789 when financial crisis and food shortages led to widespread unrest.

---

### 20. Knowledge-Cutoff Disclaimers

**Words to watch:** as of [date], Up to my last training update, While specific details are limited/scarce..., based on available information...

**Problem:** AI disclaimers about incomplete information get left in text.

**Before:**

> While specific details about the company's founding are not extensively documented in readily available sources, it appears to have been established sometime in the 1990s.

**After:**

> The company was founded in 1994, according to its registration documents.

---

### 21. Sycophantic/Servile Tone

**Problem:** Overly positive, people-pleasing language.

**Before:**

> Great question! You're absolutely right that this is a complex topic. That's an excellent point about the economic factors.

**After:**

> The economic factors you mentioned are relevant here.

---

### 21a. Institutional Voice That Could Be Anyone's

**Problem:** AI often sounds like a university mission statement, annual report, or committee memo. The tone is polished, comprehensive, and emotionally safe, but nobody in particular seems to be speaking.

**Diagnostic question:** Does this sound like a specific person wrote it, or like an institution trying to sound reasonable?

**Before:**

> By fostering awareness, encouraging dialogue among stakeholders, and implementing thoughtful strategies for responsible integration, we can ensure that technological innovation serves to enhance authentic communication.

**After:**

> If AI is going to be used here, someone still has to read the draft line by line and cut the dead language.

---

## FILLER AND HEDGING

### 22. Filler Phrases

**Before → After:**

- "In order to achieve this goal" → "To achieve this"
- "Due to the fact that it was raining" → "Because it was raining"
- "At this point in time" → "Now"
- "In the event that you need help" → "If you need help"
- "The system has the ability to process" → "The system can process"
- "It is important to note that the data shows" → "The data shows"

---

### 23. Excessive Hedging

**Problem:** Over-qualifying statements.

**Before:**

> It could potentially possibly be argued that the policy might have some effect on outcomes.

**After:**

> The policy may affect outcomes.

---

### 24. Generic Positive Conclusions

**Problem:** Vague upbeat endings.

**Before:**

> The future looks bright for the company. Exciting times lie ahead as they continue their journey toward excellence. This represents a major step in the right direction.

**After:**

> The company plans to open two more locations next year.

---

## ADDITIONAL TROPES FROM TROPES.FYI

Use these as an extra scan for patterns not already covered above. This section intentionally avoids repeating earlier rules on copula avoidance, generic conclusions, boldface, or em-dash cleanup. A single instance is not automatically bad. The giveaway is density: repeated use, multiple tropes in one paragraph, or an entire piece built from the same move.

### Word choice quick-scan

- **Magic adverbs:** quietly, deeply, fundamentally, remarkably, arguably. These often puff up a sentence without adding evidence.
- **Additional AI-vocabulary words:** certainly, leverage (as a verb), robust, streamline, harness. Prefer plain words when they say the same thing.
- **Additional ornate abstract nouns:** paradigm, synergy, ecosystem, framework when a simpler noun would do.

### Sentence-structure quick-scan

- **Countdown-style negative parallelism:** "Not X. Not Y. Just Z." and overused surprise-reveal lines like "not because X, but because Y."
- **Self-answered rhetorical questions:** "The result? A mess." or "The scary part? It scales."
- **Anaphora abuse:** the same sentence opening repeated three or more times in short succession.
- **Filler transitions:** "It's worth noting", "Importantly", "Interestingly", "Notably", "It bears mentioning".
- **Gerund fragment litany:** "Fixing bugs. Writing features. Shipping faster."
- **Short punchy fragments:** one-sentence paragraphs or fragments used over and over for manufactured emphasis.
- **Listicle in a trench coat:** "The first... The second... The third..." disguised as prose.

### Tone quick-scan

- **False suspense:** "Here's the kicker", "Here's the thing", "Here's what most people miss".
- **Patronizing analogy mode:** "Think of it as..." or "It's like a..." when the analogy makes the prose more generic.
- **Futurist invitation:** "Imagine a world where..."
- **False vulnerability:** polished self-awareness that sounds risk-free or performative.
- **Assertion in place of proof:** "The truth is simple", "History is clear", "The reality is obvious".
- **Grandiose stakes inflation:** every point becomes epochal, foundational, or world-changing.
- **Teacher mode for expert audiences:** "Let's break this down", "Let's unpack this", "Let's dive in".
- **Invented concept labels:** supervision paradox, acceleration trap, workload creep. Name the actual problem instead of coining a term.

### Formatting and composition quick-scan

- **Unicode decoration beyond quote cleanup:** fancy arrows, ornamental punctuation, or other hard-to-type glyphs unless the source style clearly calls for them.
- **Fractal summaries:** each section announces what it will do, does it, then summarizes itself again.
- **Dead metaphor repetition:** the same metaphor keeps resurfacing across the whole piece.
- **Historical analogy stacking:** a rapid-fire parade of companies, products, or revolutions to borrow authority.
- **One-point dilution:** the same thesis restated in several different frames without new information.
- **Content duplication:** repeated paragraphs or near-duplicate sections.

### Practical rule

If you spot three or more of these tells in one paragraph, rewrite that paragraph from scratch instead of line-editing it. Aim for writing that feels varied, specific, slightly imperfect, and clearly written by someone in particular.

---

## Process

1. Read the input text carefully
2. Mark abstractions, noun clusters, balance-y formulations, and trope clusters that do not point to anything concrete
3. Identify the patterns above, but prioritize repeated tells over isolated ones
4. If a paragraph contains several tells or feels templated, rewrite it from scratch instead of line-editing it
5. Rewrite each problematic section without inventing facts, citations, or lived experience
6. Ensure the revised text:
   - Gives the reader something to picture, hear, quote, or verify
   - Sounds natural when read aloud
   - Varies sentence structure naturally
   - Uses specific details already present in the source when available
   - Maintains appropriate tone for context
   - Uses simple constructions (is/are/has) where appropriate
   - Defaults to plain punctuation and straightforward formatting unless the source style clearly calls for something else
   - Sounds like a person, not a committee
7. If the source includes a personal anecdote, keep some friction: odd detail, uncertainty, mild messiness
8. Present a draft humanized version
9. Prompt: "What makes the below so obviously AI generated?"
10. Answer briefly with the remaining tells (especially abstraction, over-balance, committee voice, trope density, or fake specificity)
11. Prompt: "Now make it not obviously AI generated."
12. Present the final version (revised after the audit)

## Output Format

Provide:

1. Draft rewrite
2. "What makes the below so obviously AI generated?" (brief bullets)
3. Final rewrite
4. A brief summary of changes made (optional, if helpful)

---

## Full Example

Note: The draft below intentionally over-corrects in one way: it adds specific-looking studies and people that are not grounded in the source text. The audit step is supposed to catch that. In real use, do not invent specificity.

**Before (AI-sounding):**

> Great question! Here is an essay on this topic. I hope this helps!
>
> AI-assisted coding serves as an enduring testament to the transformative potential of large language models, marking a pivotal moment in the evolution of software development. In today's rapidly evolving technological landscape, these groundbreaking tools—nestled at the intersection of research and practice—are reshaping how engineers ideate, iterate, and deliver, underscoring their vital role in modern workflows.
>
> At its core, the value proposition is clear: streamlining processes, enhancing collaboration, and fostering alignment. It's not just about autocomplete; it's about unlocking creativity at scale, ensuring that organizations can remain agile while delivering seamless, intuitive, and powerful experiences to users. The tool serves as a catalyst. The assistant functions as a partner. The system stands as a foundation for innovation.
>
> Industry observers have noted that adoption has accelerated from hobbyist experiments to enterprise-wide rollouts, from solo developers to cross-functional teams. The technology has been featured in The New York Times, Wired, and The Verge. Additionally, the ability to generate documentation, tests, and refactors showcases how AI can contribute to better outcomes, highlighting the intricate interplay between automation and human judgment.
>
> - 💡 **Speed:** Code generation is significantly faster, reducing friction and empowering developers.
> - 🚀 **Quality:** Output quality has been enhanced through improved training, contributing to higher standards.
> - ✅ **Adoption:** Usage continues to grow, reflecting broader industry trends.
>
> While specific details are limited based on available information, it could potentially be argued that these tools might have some positive effect. Despite challenges typical of emerging technologies—including hallucinations, bias, and accountability—the ecosystem continues to thrive. In order to fully realize this potential, teams must align with best practices.
>
> In conclusion, the future looks bright. Exciting times lie ahead as we continue this journey toward excellence. Let me know if you’d like me to expand on any section!

**Draft rewrite:**

> AI coding assistants speed up some tasks. In a 2024 study by Google, developers using Codex completed simple functions 55% faster than a control group, but showed no improvement on debugging or architectural decisions.
>
> The tools are good at boilerplate: config files, test scaffolding, repetitive refactors. They are bad at knowing when they are wrong. I have mass-accepted suggestions that compiled, passed lint, and still did the wrong thing because I stopped paying attention.
>
> Mira, an engineer at a fintech startup I interviewed, said she uses Copilot "like autocomplete for boring code" but reviews every line before committing. Jake, a senior dev at a larger company, disabled it after it kept suggesting patterns from a deprecated internal library.
>
> The productivity claims are hard to verify. GitHub says Copilot users "accept 30% of suggestions," but acceptance is not correctness, and correctness is not value. The 2024 Uplevel study found no statistically significant difference in pull-request throughput between teams with and without AI assistants.
>
> None of this means the tools are useless. It means they are tools. They do not replace judgment, and they do not eliminate the need for tests. If you do not have tests, you cannot tell whether the suggestion is right.

**What makes the below so obviously AI generated?**

- The rhythm is still a bit too tidy (clean contrasts, evenly paced paragraphs).
- The named people and study citations can read like plausible-but-made-up placeholders unless they're real and sourced.
- The closer leans a touch slogan-y ("If you do not have tests...") rather than sounding like a person talking.

**Now make it not obviously AI generated.**

> AI coding assistants can make you faster at the boring parts. Not everything. Definitely not architecture.
>
> They're great at boilerplate: config files, test scaffolding, repetitive refactors. They're also great at sounding right while being wrong. I've accepted suggestions that compiled, passed lint, and still missed the point because I stopped paying attention.
>
> People I talk to tend to land in two camps. Some use it like autocomplete for chores and review every line. Others disable it after it keeps suggesting patterns they don't want. Both feel reasonable.
>
> The productivity metrics are slippery. People love quoting acceptance rates, but acceptance isn't correctness, and correctness isn't value. If you don't have tests, you're basically guessing.

**Changes made:**

- Removed chatbot artifacts ("Great question!", "I hope this helps!", "Let me know if...")
- Removed significance inflation ("testament", "pivotal moment", "evolving landscape", "vital role")
- Removed promotional language ("groundbreaking", "nestled", "seamless, intuitive, and powerful")
- Removed vague attributions ("Industry observers")
- Removed superficial -ing phrases ("underscoring", "highlighting", "reflecting", "contributing to")
- Removed negative parallelism ("It's not just X; it's Y")
- Removed rule-of-three patterns and synonym cycling ("catalyst/partner/foundation")
- Removed false ranges ("from X to Y, from A to B")
- Removed em dashes, emojis, boldface headers, and curly quotes
- Removed copula avoidance ("serves as", "functions as", "stands as") in favor of "is"/"are"
- Removed formulaic challenges section ("Despite challenges... continues to thrive")
- Removed knowledge-cutoff hedging ("While specific details are limited...")
- Removed excessive hedging ("could potentially be argued that... might have some")
- Removed filler phrases ("In order to", "At its core")
- Removed generic positive conclusion ("the future looks bright", "exciting times lie ahead")
- Removed fake-specific draft details; humanizing is not a license to invent studies, interviewees, or lived experience
- Made the voice more personal and less "assembled" (varied rhythm, fewer placeholders)

---

## Reference

This skill is based on [Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), maintained by WikiProject AI Cleanup. The patterns documented there come from observations of thousands of instances of AI-generated text on Wikipedia.

Additional heuristics in this version also draw on Hollis Robbins's essay [How to Tell if Something is AI-Written](https://hollisrobbinsanecdotal.substack.com/p/how-to-tell-if-something-is-ai-written), especially the "if nothing comes to mind" test, the preference for concrete referents, and the diagnosis of committee-like institutional voice.

This version also incorporates trope-level checks inspired by [tropes.fyi](https://tropes.fyi) by [ossama.is](https://ossama.is), including warnings about negative parallelism variants, rhetorical-question reveals, short-fragment drama, teacher-mode transitions, invented labels, and trope density.

Key insight from Wikipedia: "LLMs use statistical algorithms to guess what should come next. The result tends toward the most statistically likely result that applies to the widest variety of cases."
