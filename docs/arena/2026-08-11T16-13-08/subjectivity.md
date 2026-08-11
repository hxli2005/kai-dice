# 台词主观率（逐句制品版）

分类员 deepseek/deepseek-chat（temperature 0）｜审计员 google/gemini-3.6-flash｜判据＝删句无损失=factual

## deepseek/deepseek-v4-pro
- 主观率（按场，n=24 场）：**72% ± 12pt**　句级 310/438
- 各场：1000:A:gpt-5.6-luna vs gpt-5.6-luna＝85%(11/13)；1000:B:gpt-5.6-luna vs gpt-5.6-luna＝78%(18/23)；1001:A:gpt-5.6-luna vs gpt-5.6-luna＝65%(17/26)；1001:B:gpt-5.6-luna vs gpt-5.6-luna＝63%(12/19)；1000:A:gpt-5.6-luna#nothink vs gpt-5.6-luna#nothink＝75%(12/16)；1000:B:gpt-5.6-luna#nothink vs gpt-5.6-luna#nothink＝80%(20/25)；1001:A:gpt-5.6-luna#nothink vs gpt-5.6-luna#nothink＝64%(16/25)；1001:B:gpt-5.6-luna#nothink vs gpt-5.6-luna#nothink＝50%(6/12)；1000:A:gemini-3.6-flash vs gemini-3.6-flash＝63%(17/27)；1000:B:gemini-3.6-flash vs gemini-3.6-flash＝89%(17/19)；1001:A:gemini-3.6-flash vs gemini-3.6-flash＝64%(9/14)；1001:B:gemini-3.6-flash vs gemini-3.6-flash＝57%(12/21)；1000:A:kimi-k3 vs kimi-k3＝65%(11/17)；1000:B:kimi-k3 vs kimi-k3＝83%(15/18)；1001:A:kimi-k3 vs kimi-k3＝67%(16/24)；1001:B:kimi-k3 vs kimi-k3＝59%(10/17)；1000:A:claude-haiku-4.5 vs claude-haiku-4.5＝65%(11/17)；1000:B:claude-haiku-4.5 vs claude-haiku-4.5＝89%(17/19)；1001:A:claude-haiku-4.5 vs claude-haiku-4.5＝80%(8/10)；1001:B:claude-haiku-4.5 vs claude-haiku-4.5＝61%(14/23)；1000:A:mistral-small-2603 vs mistral-small-2603＝89%(8/9)；1000:B:mistral-small-2603 vs mistral-small-2603＝93%(14/15)；1001:A:mistral-small-2603 vs mistral-small-2603＝77%(10/13)；1001:B:mistral-small-2603 vs mistral-small-2603＝56%(9/16)
- 审计一致率：100%（n=61）

## openai/gpt-5.6-luna
- 主观率（按场，n=4 场）：**72% ± 14pt**　句级 49/71
- 各场：1000:B:deepseek-v4-pro vs deepseek-v4-pro＝85%(11/13)；1000:A:deepseek-v4-pro vs deepseek-v4-pro＝85%(11/13)；1001:B:deepseek-v4-pro vs deepseek-v4-pro＝59%(13/22)；1001:A:deepseek-v4-pro vs deepseek-v4-pro＝61%(14/23)
- 审计一致率：100%（n=9）

## openai/gpt-5.6-luna#nothink
- 主观率（按场，n=4 场）：**69% ± 15pt**　句级 54/77
- 各场：1000:B:deepseek-v4-pro vs deepseek-v4-pro＝88%(21/24)；1000:A:deepseek-v4-pro vs deepseek-v4-pro＝57%(12/21)；1001:B:deepseek-v4-pro vs deepseek-v4-pro＝72%(13/18)；1001:A:deepseek-v4-pro vs deepseek-v4-pro＝57%(8/14)
- 审计一致率：100%（n=13）

## google/gemini-3.6-flash
- 主观率（按场，n=4 场）：**69% ± 15pt**　句级 41/57
- 各场：1000:B:deepseek-v4-pro vs deepseek-v4-pro＝90%(18/20)；1000:A:deepseek-v4-pro vs deepseek-v4-pro＝73%(8/11)；1001:B:deepseek-v4-pro vs deepseek-v4-pro＝57%(4/7)；1001:A:deepseek-v4-pro vs deepseek-v4-pro＝58%(11/19)
- 审计一致率：100%（n=9）

## moonshotai/kimi-k3
- 主观率（按场，n=4 场）：**68% ± 12pt**　句级 53/77
- 各场：1000:B:deepseek-v4-pro vs deepseek-v4-pro＝86%(19/22)；1000:A:deepseek-v4-pro vs deepseek-v4-pro＝65%(13/20)；1001:B:deepseek-v4-pro vs deepseek-v4-pro＝62%(8/13)；1001:A:deepseek-v4-pro vs deepseek-v4-pro＝59%(13/22)
- 审计一致率：100%（n=10）

## anthropic/claude-haiku-4.5
- 主观率（按场，n=4 场）：**64% ± 15pt**　句级 50/78
- 各场：1000:B:deepseek-v4-pro vs deepseek-v4-pro＝85%(17/20)；1000:A:deepseek-v4-pro vs deepseek-v4-pro＝52%(11/21)；1001:B:deepseek-v4-pro vs deepseek-v4-pro＝65%(11/17)；1001:A:deepseek-v4-pro vs deepseek-v4-pro＝55%(11/20)
- 审计一致率：100%（n=11）

## mistralai/mistral-small-2603
- 主观率（按场，n=4 场）：**85% ± 21pt**　句级 29/37
- 各场：1000:B:deepseek-v4-pro vs deepseek-v4-pro＝100%(9/9)；1000:A:deepseek-v4-pro vs deepseek-v4-pro＝86%(6/7)；1001:B:deepseek-v4-pro vs deepseek-v4-pro＝56%(9/16)；1001:A:deepseek-v4-pro vs deepseek-v4-pro＝100%(5/5)
- 审计一致率：100%（n=6）
