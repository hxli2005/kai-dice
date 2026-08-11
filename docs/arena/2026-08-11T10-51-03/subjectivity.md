# 台词主观率（逐句制品版）

分类员 deepseek/deepseek-chat（temperature 0）｜审计员 google/gemini-3.6-flash｜判据＝删句无损失=factual

## openai/gpt-5.6-luna
- 主观率（按场，n=4 场）：**34% ± 20pt**　句级 23/69
- 各场：1000:A vs deepseek-v4-pro＝60%(9/15)；1000:B vs deepseek-v4-pro＝13%(2/15)；1001:A vs deepseek-v4-pro＝35%(7/20)；1001:B vs deepseek-v4-pro＝26%(5/19)
- 审计一致率：89%（n=9）

## deepseek/deepseek-v4-pro
- 主观率（按场，n=4 场）：**36% ± 20pt**　句级 31/80
- 各场：1000:B vs gpt-5.6-luna＝19%(3/16)；1000:A vs gpt-5.6-luna＝63%(17/27)；1001:B vs gpt-5.6-luna＝25%(5/20)；1001:A vs gpt-5.6-luna＝35%(6/17)
- 审计一致率：92%（n=13）
