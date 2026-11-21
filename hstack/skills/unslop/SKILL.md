---
name: unslop
description: Cut AI tells from any writing.
disable-model-invocation: true
---

# Unslop

Edit text to remove AI patterns. Scan for the patterns below, then rewrite. Preserve meaning and match the intended tone.

Rule numbers are stable ids that other skills cite. A removed rule leaves a gap.

3. No trailing "-ing" phrases that add no fact ("highlighting...", "ensuring..."; in Korean "~을 강조하며", "~을 보장하면서").
5. No vague attributions ("experts believe"; in Korean "전문가들은 ~라고 본다", "~로 알려져 있다"). Name the source or delete.
7. No AI vocabulary: additionally, crucial, delve, enhance, foster, landscape, pivotal, showcase, testament, underscore, vibrant. In Korean: 또한, 나아가, 핵심적인, 획기적인, 다채로운, 심층적으로, 극대화하다, 돋보이다, 주목할 만한.
8. Say "is" or "has", not "serves as", "stands as", "boasts", "features". In Korean "~이다" or "~가 있다", not "~로서 기능한다", "~의 역할을 한다", "~을 자랑한다".
9. No "not just X, but Y" ("단순히 X가 아니라 Y", "X뿐만 아니라 Y"). State the point.
10. Don't force ideas into threes.
11. One name per thing. Repeat it.
12. No "from X to Y" ("X부터 Y까지", "X에서 Y에 이르기까지") unless X and Y sit on a real scale.
13. No em dashes, en dashes, or hyphens used as dashes, and no parentheses in their place. Use a period or a comma.
14. A colon goes before a list or an example, never mid-sentence as a connector.
15. Don't bold every proper noun or acronym.
16. No bold label and colon that restates its line ("**Performance:** Performance improved...", "**성능:** 성능이 개선되었다..."). A bold lead-in that ends in a period and adds new detail is fine.
17. Sentence case headings.
18. No decorative emojis.
19. Straight quotes.
20. No chatbot phrases ("I hope this helps!", "Let me know if..."; in Korean "도움이 되었길 바랍니다", "더 필요하면 말씀해 주세요").
22. No praise or agreement openers. Respond directly.
23. Cut filler. "In order to" becomes "to". Delete "it is important to note that". In Korean "~하기 위해서는" becomes "~하려면", and "~라는 점에 유의해야 한다" goes.
24. One hedge at most: "may". In Korean "~일 수 있다", never "~일 수도 있을 것으로 보인다".
25. No generic conclusions. State specific plans or facts.
26. No abstract metaphor nouns: substrate, wedge, vector, nexus, primitive, harness, surface, scaffolding, paradigm, ratchet, north star, flywheel. In Korean: 패러다임, 생태계, 토대, 지형, 청사진, 나침반, 선순환. Use the concrete word.
27. Say what it does, not how it feels. Name the mechanism or the number. Cut a sentence that could appear unchanged in another project's docs.
28. One idea per sentence. Split a sentence the reader has to reread.
29. Active voice. Name the actor unless it is unknown or doesn't matter.
30. Cut adverbs or use a stronger verb. Give the number.
31. Use the plain word: "use", not "utilize" or "leverage". In Korean "쓰다", not "활용하다" or "구사하다".
32. No metaphor, aphorism, personified code, or figurative verb where a literal phrase exists.
33. Write whole sentences with their articles and verbs. Spell out arrows and abbreviations.
