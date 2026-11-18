# smt-special

שלוחת API בימות המשיח לאימות זיהוי יוצא (Caller ID).

הועבר מ-Netlify (`smt-special.netlify.app`, פונקציה `api`) ל-Cloudflare Worker, עם אותה לוגיקה ואותן תשובות.
ההבדל: בדיקת הטוקן וטעינת קובץ הסשן רצות במקביל, והשרת קרוב לישראל במקום בארה"ב.

## פרמטרים מימות המשיח
- `token` - טוקן ימות המשיח, או `Login` יחד עם `username` ו-`password`
- `ApiCallId`, `ApiExtension` - נשלחים אוטומטית מהשלוחה

## שלבים
1. הקשת מספר טלפון (`phone_number_to_validate`)
2. נשלחת שיחה עם קוד אימות
3. הקשת הקוד (`code_attempt_<קוד חדש>_<ניסיון>`), כוכבית שולחת קוד חדש

נתוני הסשן נשמרים בימות המשיח בקובץ `ivr2:/<ApiExtension>/<ApiCallId>.ini`.
