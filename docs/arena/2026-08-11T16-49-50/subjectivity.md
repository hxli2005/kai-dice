# 台词主观率（逐句制品版）

分类员 deepseek/deepseek-chat（temperature 0）｜审计员 google/gemini-3.6-flash｜判据＝删句无损失=factual

## openai/gpt-5.6-luna
- 主观率（按场，n=8 场）：**40% ± 15pt**　句级 45/114
- 各场：1000:A:mistral-small-2603 vs mistral-small-2603＝33%(4/12)；1000:B:mistral-small-2603 vs mistral-small-2603＝28%(5/18)；1001:A:mistral-small-2603 vs mistral-small-2603＝36%(4/11)；1001:B:mistral-small-2603 vs mistral-small-2603＝63%(10/16)；1000:A:claude-haiku-4.5 vs claude-haiku-4.5＝50%(5/10)；1000:B:claude-haiku-4.5 vs claude-haiku-4.5＝20%(3/15)；1001:A:claude-haiku-4.5 vs claude-haiku-4.5＝35%(7/20)；1001:B:claude-haiku-4.5 vs claude-haiku-4.5＝58%(7/12)
- 审计一致率：82%（n=17）

## mistralai/mistral-small-2603
- 主观率（按场，n=4 场）：**38% ± 6pt**　句级 19/51
- 各场：1000:B:gpt-5.6-luna vs gpt-5.6-luna＝31%(5/16)；1000:A:gpt-5.6-luna vs gpt-5.6-luna＝36%(4/11)；1001:B:gpt-5.6-luna vs gpt-5.6-luna＝45%(5/11)；1001:A:gpt-5.6-luna vs gpt-5.6-luna＝38%(5/13)
- 审计一致率：88%（n=8）

## anthropic/claude-haiku-4.5
- 主观率（按场，n=4 场）：**42% ± 12pt**　句级 37/86
- 各场：1000:B:gpt-5.6-luna vs gpt-5.6-luna＝32%(6/19)；1000:A:gpt-5.6-luna vs gpt-5.6-luna＝43%(9/21)；1001:B:gpt-5.6-luna vs gpt-5.6-luna＝58%(14/24)；1001:A:gpt-5.6-luna vs gpt-5.6-luna＝36%(8/22)
- 审计一致率：92%（n=12）
