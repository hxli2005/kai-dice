# 台词主观率（逐句制品版）

分类员 deepseek/deepseek-chat（temperature 0）｜审计员 google/gemini-3.6-flash｜判据＝删句无损失=factual

## openai/gpt-5.6-luna
- 主观率（按场，n=13 场）：**32% ± 22pt**　句级 52/204
- 各场：1000:A:gemini-3.6-flash vs gemini-3.6-flash＝25%(3/12)；1000:B:gemini-3.6-flash vs gemini-3.6-flash＝38%(6/16)；1001:A:gemini-3.6-flash vs gemini-3.6-flash＝24%(5/21)；1001:B:gemini-3.6-flash vs gemini-3.6-flash＝23%(5/22)；1000:A:kimi-k3 vs kimi-k3＝12%(2/17)；1000:B:kimi-k3 vs kimi-k3＝40%(6/15)；1001:A:kimi-k3 vs kimi-k3＝26%(5/19)；1001:B:kimi-k3 vs kimi-k3＝19%(4/21)；1000:A:claude-haiku-4.5 vs claude-haiku-4.5＝19%(4/21)；1000:B:claude-haiku-4.5 vs claude-haiku-4.5＝40%(6/15)；1001:A:claude-haiku-4.5 vs claude-haiku-4.5＝18%(3/17)；1001:B:claude-haiku-4.5 vs claude-haiku-4.5＝29%(2/7)；1000:A:mistral-small-2603 vs mistral-small-2603＝100%(1/1)
- 审计一致率：55%（n=11，审计失败另计 16）

## google/gemini-3.6-flash
- 主观率（按场，n=4 场）：**32% ± 13pt**　句级 19/59
- 各场：1000:B:gpt-5.6-luna vs gpt-5.6-luna＝47%(7/15)；1000:A:gpt-5.6-luna vs gpt-5.6-luna＝33%(4/12)；1001:B:gpt-5.6-luna vs gpt-5.6-luna＝32%(6/19)；1001:A:gpt-5.6-luna vs gpt-5.6-luna＝15%(2/13)
- 审计一致率：50%（n=2，审计失败另计 6）

## moonshotai/kimi-k3
- 主观率（按场，n=4 场）：**29% ± 6pt**　句级 24/82
- 各场：1000:B:gpt-5.6-luna vs gpt-5.6-luna＝38%(9/24)；1000:A:gpt-5.6-luna vs gpt-5.6-luna＝31%(4/13)；1001:B:gpt-5.6-luna vs gpt-5.6-luna＝24%(5/21)；1001:A:gpt-5.6-luna vs gpt-5.6-luna＝25%(6/24)
- 审计一致率：60%（n=5，审计失败另计 7）

## anthropic/claude-haiku-4.5
- 主观率（按场，n=4 场）：**24% ± 10pt**　句级 17/73
- 各场：1000:B:gpt-5.6-luna vs gpt-5.6-luna＝31%(8/26)；1000:A:gpt-5.6-luna vs gpt-5.6-luna＝20%(4/20)；1001:B:gpt-5.6-luna vs gpt-5.6-luna＝11%(2/18)；1001:A:gpt-5.6-luna vs gpt-5.6-luna＝33%(3/9)
- 审计一致率：75%（n=4，审计失败另计 6）
