# ES unified_rag source -> category mapping (from config.json)
# medical: kuake_qtr, kuake_qic, kuake_qic_full
# general: cmrc2018
# game: game_strategy
# law: cail2018
# 小说/其他: 星辰变, イベント, 红色沙漠, 除灵猎人

# 从 ES aggregation 精确数字
medical = 23880  # kuake_qtr
general = 3507   # cmrc2018

# 小说/游戏: 星辰变18集 + イベント + 红色沙漠 + 除灵猎人
xc = [638,628,576,539,444,420,419,409,403,311,264,147,146,146,144,143,129,17]
novel = sum(xc) + 589 + 14 + 6

print(f"医疗 (kuake_qtr):      {medical:>6,}")
print(f"百科 (cmrc2018):       {general:>6,}")
print(f"小说+游戏攻略:         {novel:>6,}")
print(f"{'─' * 30}")
print(f"合计:                  {medical+general+novel:>6,}")
print(f"ES unified_rag 实际:   33,919")
print(f"差值:                  {33919-(medical+general+novel)}")
