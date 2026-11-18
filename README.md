# smt-special

שלוחת API בימות המשיח לאימות זיהוי יוצא (Caller ID).

הועבר מ-Netlify (`smt-special.netlify.app`, פונקציה `api`) ל-Cloudflare Worker, עם אותה לוגיקה ואותן תשובות.
ההבדל: בדיקת הטוקן וטעינת קובץ הסשן רצות במקביל, והשרת קרוב לישראל במקום בארה"ב.

## כתובת השלוחה
`https://smti.uk/special`

הפרסום ל-Cloudflare אוטומטי מ-GitHub (Workers Builds) בכל דחיפה ל-`main`.

## פרמטרים מימות המשיח
- `token` - טוקן ימות המשיח, או `Login` יחד עם `username` ו-`password`
- `ApiCallId`, `ApiExtension` - נשלחים אוטומטית מהשלוחה
- `names` (לא חובה) - נתיב קובץ תרגומים, למשל `ivr2:Log/shar.ini`. השמות משורות `YourID=מספר=שם` מוקראים כתפריט: הראשון בקובץ מקש 1, השני מקש 2 וכו'. אפשר גם להקיש מספר טלפון מלא.

## שלבים
1. הקשת מספר טלפון, או מקש של מספר שמור כשמוגדר `names` (`phone_number_to_validate`)
2. נשלחת שיחה עם קוד אימות
3. הקשת הקוד (`code_attempt_<קוד חדש>_<ניסיון>`), כוכבית שולחת קוד חדש

נתוני הסשן נשמרים בימות המשיח בקובץ `ivr2:/<ApiExtension>/<ApiCallId>.ini`.
