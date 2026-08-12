# 台词主观率（逐句制品版）

分类员 deepseek/deepseek-chat（temperature 0）｜审计员 google/gemini-3.6-flash｜判据＝删句无损失=factual

## openai/gpt-5.6-luna
- 主观率（按场，n=13 场）：**42% ± 30pt**　句级 74/204
- 各场：m0(1000:A) vs gemini-3.6-flash＝17%(2/12)；m1(1000:B) vs gemini-3.6-flash＝13%(2/16)；m2(1001:A) vs gemini-3.6-flash＝29%(6/21)；m3(1001:B) vs gemini-3.6-flash＝45%(10/22)；m4(1000:A) vs kimi-k3＝88%(15/17)；m5(1000:B) vs kimi-k3＝53%(8/15)；m6(1001:A) vs kimi-k3＝42%(8/19)；m7(1001:B) vs kimi-k3＝43%(9/21)〔顶班2手〕；m8(1000:A) vs claude-haiku-4.5＝14%(3/21)；m9(1000:B) vs claude-haiku-4.5＝7%(1/15)；m10(1001:A) vs claude-haiku-4.5＝24%(4/17)；m11(1001:B) vs claude-haiku-4.5＝71%(5/7)〔顶班11手〕；m12(1000:A) vs mistral-small-2603＝100%(1/1)〔顶班23手〕
- 审计一致率：92%（n=25，审计失败另计 7）

## google/gemini-3.6-flash
- 主观率（按场，n=4 场）：**60% ± 26pt**　句级 35/59
- 各场：m0(1000:B) vs gpt-5.6-luna＝80%(12/15)；m1(1000:A) vs gpt-5.6-luna＝33%(4/12)；m2(1001:B) vs gpt-5.6-luna＝42%(8/19)；m3(1001:A) vs gpt-5.6-luna＝85%(11/13)
- 审计一致率：71%（n=7）

## moonshotai/kimi-k3
- 主观率（按场，n=4 场）：**81% ± 35pt**　句级 64/82
- 各场：m4(1000:B) vs gpt-5.6-luna＝96%(23/24)；m5(1000:A) vs gpt-5.6-luna＝100%(13/13)；m6(1001:B) vs gpt-5.6-luna＝100%(21/21)；m7(1001:A) vs gpt-5.6-luna＝29%(7/24)〔顶班2手〕
- 审计一致率：100%（n=14）

## anthropic/claude-haiku-4.5
- 主观率（按场，n=4 场）：**25% ± 20pt**　句级 17/73
- 各场：m8(1000:B) vs gpt-5.6-luna＝38%(10/26)〔顶班1手〕；m9(1000:A) vs gpt-5.6-luna＝5%(1/20)；m10(1001:B) vs gpt-5.6-luna＝11%(2/18)；m11(1001:A) vs gpt-5.6-luna＝44%(4/9)〔顶班12手〕
- 审计一致率：75%（n=4，审计失败另计 6）
