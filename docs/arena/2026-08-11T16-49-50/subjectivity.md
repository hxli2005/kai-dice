# 台词主观率（逐句制品版）

分类员 deepseek/deepseek-chat（temperature 0）｜审计员 google/gemini-3.6-flash｜判据＝删句无损失=factual

## openai/gpt-5.6-luna
- 主观率（按场，n=8 场）：**45% ± 18pt**　句级 48/114
- 各场：m0(1000:A) vs mistral-small-2603＝58%(7/12)；m1(1000:B) vs mistral-small-2603＝28%(5/18)；m2(1001:A) vs mistral-small-2603＝45%(5/11)；m3(1001:B) vs mistral-small-2603＝56%(9/16)；m4(1000:A) vs claude-haiku-4.5＝70%(7/10)；m5(1000:B) vs claude-haiku-4.5＝27%(4/15)；m6(1001:A) vs claude-haiku-4.5＝20%(4/20)；m7(1001:B) vs claude-haiku-4.5＝58%(7/12)
- 审计一致率：88%（n=16）

## mistralai/mistral-small-2603
- 主观率（按场，n=4 场）：**65% ± 17pt**　句级 34/51
- 各场：m0(1000:B) vs gpt-5.6-luna＝81%(13/16)；m1(1000:A) vs gpt-5.6-luna＝55%(6/11)；m2(1001:B) vs gpt-5.6-luna＝45%(5/11)；m3(1001:A) vs gpt-5.6-luna＝77%(10/13)
- 审计一致率：100%（n=6）

## anthropic/claude-haiku-4.5
- 主观率（按场，n=4 场）：**57% ± 16pt**　句级 49/86
- 各场：m4(1000:B) vs gpt-5.6-luna＝58%(11/19)；m5(1000:A) vs gpt-5.6-luna＝76%(16/21)〔顶班1手〕；m6(1001:B) vs gpt-5.6-luna＝58%(14/24)；m7(1001:A) vs gpt-5.6-luna＝36%(8/22)〔顶班1手〕
- 审计一致率：53%（n=15）
