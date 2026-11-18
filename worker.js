// smt-special - אימות זיהוי יוצא בימות המשיח
// הועבר מ-Netlify (netlify/functions/api.js) ל-Cloudflare Worker, אותה לוגיקה ואותן תשובות.

const YEMOT_API_BASE = "https://www.call2all.co.il/ym/api";

// --- תשובה לימות המשיח ---
function formatYemotResponse(command) {
  return new Response(command, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// --- קריאת API לימות המשיח (במקום axios) ---
async function fetchApiData(url, method = "get", params = {}) {
  try {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) qs.append(k, String(v));
    }
    const res = await fetch(`${url}?${qs.toString()}`, {
      method: method.toUpperCase(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error("Fetch Error:", error.message);
    return null;
  }
}

// --- קובץ הסשן (נתוני האימות) ---
async function saveSessionFile(token, filePath, sessionData) {
  const content = Object.entries(sessionData)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const result = await fetchApiData(`${YEMOT_API_BASE}/UploadTextFile`, "post", {
    token,
    what: filePath,
    contents: content,
  });
  return result && result.responseStatus === "OK";
}

async function loadSessionFile(token, filePath) {
  const result = await fetchApiData(`${YEMOT_API_BASE}/GetTextFile`, "get", {
    token,
    what: filePath,
  });

  if (result && result.responseStatus === "OK" && result.contents) {
    const data = {};
    result.contents.split("\n").forEach((line) => {
      const [key, value] = line.split("=");
      if (key && value) {
        data[key.trim()] = value.trim();
      }
    });
    data.new_code_counter = parseInt(data.new_code_counter || "0", 10);
    data.wrong_code_counter = parseInt(data.wrong_code_counter || "0", 10);
    return data;
  }
  return null;
}

// --- לוגיקה ---
async function getNewReqId(token, phoneNumber) {
  const data = await fetchApiData(`${YEMOT_API_BASE}/ValidationCallerId`, "get", {
    token,
    action: "send",
    callerId: phoneNumber,
    validType: "CALL",
  });
  return data && data.responseStatus === "OK" && data.reqId ? data.reqId : null;
}

async function validateCode(token, reqId, code) {
  const parts = code.split(",");
  const lastInput = parts[parts.length - 1].trim();

  if (lastInput === "*") return "star";

  const codeToValidate = parts[0].trim();
  if (codeToValidate === "") return false;

  // שם הפרמטר reId נשמר כמו במקור
  const data = await fetchApiData(`${YEMOT_API_BASE}/ValidationCallerId`, "get", {
    token,
    action: "valid",
    reId: reqId,
    code: codeToValidate,
  });
  return data && data.responseStatus === "OK" && data.status === true;
}

// --- מספרים שמורים מקובץ התרגומים (שורות YourID=מספר=שם) ---
// הסדר בקובץ קובע את מקש הבחירה: הראשון 1, השני 2 וכו'
// כמות היחידות במערכת (GetCustomerData) - רק להשמעה, לא חוסם כלום
async function loadUnits(token) {
  const data = await fetchApiData(`${YEMOT_API_BASE}/GetCustomerData`, "get", { token });
  if (!data || data.responseStatus !== "OK") return null;
  const units = Number(data.units);
  return Number.isFinite(units) ? units : null;
}

async function loadSavedNumbers(token, filePath) {
  const result = await fetchApiData(`${YEMOT_API_BASE}/GetTextFile`, "get", {
    token,
    what: filePath,
  });
  if (!result || result.responseStatus !== "OK" || !result.contents) return [];

  const list = [];
  for (const line of result.contents.split("\n")) {
    const m = line.match(/^([^=]+)=([^=-]+)[=-](.+)$/);
    if (!m || m[1].trim() !== "YourID") continue;
    const num = m[2].trim();
    // ניקוי תווים ששוברים את מחרוזת ההשמעה
    const name = m[3].trim().replace(/[.\-=&,"']/g, " ").replace(/\s+/g, " ").trim();
    if (/^\d{9,10}$/.test(num) && name && !list.some((x) => x.num === num)) {
      list.push({ num, name });
    }
  }
  return list;
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);

    // כמו ב-Netlify: פרמטר שמופיע כמה פעמים מחובר בפסיקים
    const params = {};
    for (const [k, v] of url.searchParams.entries()) {
      params[k] = k in params ? `${params[k]},${v}` : v;
    }

    let { token, ApiCallId, ApiExtension, username, password } = params;
    let activeToken = token;

    // --- שלב 0: בדיקות מקדימות ---
    // --- קוד גישה: נשמר כסוד ACCESS_KEY ב-Cloudflare (לא בקוד), נשלח מהשלוחה בפרמטר key ---
    if (env.ACCESS_KEY && params.key !== env.ACCESS_KEY) {
      return formatYemotResponse("id_list_message=t-אין הרשאת גישה לשלוחה&");
    }

    if (!token) return formatYemotResponse("id_list_message=t-טוקן חסר&");
    if (!ApiCallId || !ApiExtension) return formatYemotResponse("id_list_message=t-פרמטרים חיוניים חסרים&");

    // --- טוקן דינמי ---
    if (token === "Login") {
      if (!username || !password) {
        return formatYemotResponse("id_list_message=t-חסרים פרמטרים של שם משתמש או סיסמה&");
      }

      const loginResult = await fetchApiData(`${YEMOT_API_BASE}/Login`, "get", { username, password });

      if (loginResult && loginResult.responseStatus === "OK" && loginResult.token) {
        activeToken = loginResult.token;
        await fetchApiData(`${YEMOT_API_BASE}/MFASession`, "get", { token: activeToken, action: "try" });
      } else {
        const errorMessage = loginResult ? loginResult.message : "ההתחברות נכשלה";
        return formatYemotResponse(`id_list_message=t-ההתחברות נכשלה.t-${errorMessage}&`);
      }
    }

    // נתיב קובץ הסשן
    const fullFilePath = `ivr2:/${ApiExtension}/${ApiCallId}.ini`;

    // --- בדיקת הטוקן וטעינת הסשן במקביל (במקור היו אחת אחרי השנייה) ---
    // names = נתיב קובץ התרגומים (למשל ivr2:Log/shar.ini). בלי הפרמטר - בלי רשימת מספרים שמורים
    // יחידות נטענות רק בכניסה הראשונה לתפריט הרשימה
    const isFirstEntry =
      !params.phone_number_to_validate && !Object.keys(params).some((k) => k.startsWith("code_attempt_"));
    const [tokenData, loadedSession, savedNumbers, units] = await Promise.all([
      fetchApiData(`${YEMOT_API_BASE}/MFASession`, "get", { token: activeToken, action: "isPass" }),
      loadSessionFile(activeToken, fullFilePath),
      params.names ? loadSavedNumbers(activeToken, params.names) : Promise.resolve([]),
      params.names && isFirstEntry ? loadUnits(activeToken) : Promise.resolve(null),
    ]);

    if (!tokenData || !tokenData.isPass) {
      return formatYemotResponse("id_list_message=t-טוקן שגוי או לא בתוקף&");
    }

    let sessionData = loadedSession;

    // --- מציאת הפרמטר הפעיל ---
    let activeParamName = null;
    let latestNewCounter = -1;
    let latestWrongCounter = -1;

    for (const key in params) {
      if (key.startsWith("code_attempt_")) {
        const parts = key.split("_");
        if (parts.length === 4) {
          const newCounter = parseInt(parts[2], 10);
          const wrongCounter = parseInt(parts[3], 10);

          if (newCounter > latestNewCounter) {
            latestNewCounter = newCounter;
            latestWrongCounter = wrongCounter;
            activeParamName = key;
          } else if (newCounter === latestNewCounter) {
            if (wrongCounter > latestWrongCounter) {
              latestWrongCounter = wrongCounter;
              activeParamName = key;
            }
          }
        }
      }
    }

    if (!activeParamName && params.phone_number_to_validate) {
      activeParamName = "phone_number_to_validate";
    }

    let activeParamValue = activeParamName ? params[activeParamName] : null;

    if (activeParamValue && activeParamValue.includes(",")) {
      const parts = activeParamValue.split(",");
      activeParamValue = parts[parts.length - 1].trim();
    }

    // === מצב 1: הקשת קוד (או כוכבית) ===
    if (activeParamName && activeParamName.startsWith("code_attempt_")) {
      if (!sessionData || !sessionData.reqId) {
        return formatYemotResponse("id_list_message=t-שגיאה, כשל בטעינת נתונים מקובץ הזכרון&");
      }

      const current_new_counter = latestNewCounter;
      const current_wrong_counter = latestWrongCounter;

      // --- כוכבית: קוד חדש ---
      if (activeParamValue === "*") {
        const newReqId = await getNewReqId(activeToken, sessionData.phone_number);
        if (!newReqId) return formatYemotResponse("id_list_message=t-אירעה שגיאה בשליחת קוד חדש&");

        sessionData.reqId = newReqId;
        sessionData.new_code_counter = current_new_counter + 1;
        sessionData.wrong_code_counter = 0;

        await saveSessionFile(activeToken, fullFilePath, sessionData);

        // מקום 6 = NO ומקום 15 = no: בלי הקראת הקוד ובלי אישור, אפשר להקיש שוב מיד
        const nextVarName = `code_attempt_${sessionData.new_code_counter}_1`;
        return formatYemotResponse(`read=t-קוד אימות נוסף נשלח אליכם.t-נא הקישו את הקוד=${nextVarName},,8,1,1200,NO,,yes,,,,,,,no`);
      }

      // --- בדיקת הקוד ---
      const validationResult = await validateCode(activeToken, sessionData.reqId, activeParamValue);

      if (validationResult === true) {
        return formatYemotResponse("id_list_message=t-האימות בוצע בהצלחה&");
      }

      sessionData.wrong_code_counter = current_wrong_counter;
      await saveSessionFile(activeToken, fullFilePath, sessionData);

      const nextVarName = `code_attempt_${current_new_counter}_${current_wrong_counter + 1}`;
      return formatYemotResponse(`read=t-הקוד שגוי.t-נא הקישו שוב את הקוד.t-לשליחת קוד חדש הקישו כוכבית וסולמית=${nextVarName},,8,1,1200,NO,,yes,,,,,,,no`);
    }

    // תפריט הפתיחה: עם רשימת מספרים שמורים אפשר להקיש מקש קצר או מספר מלא
    const askForNumber = (prefix = "") => {
      if (savedNumbers.length === 0) {
        return formatYemotResponse(`read=${prefix}t-מחובר למערכת.t-נא הקישו את מספר הטלפון לאימות ולסיום הקישו סולמית=phone_number_to_validate,,10,9,,Phone`);
      }
      const options = savedNumbers.map((x, i) => `לאימות ${x.name} הקישו ${i + 1}`).join(", ");
      // בכניסה הראשונה: כמה יחידות יש במערכת (עשרוני נאמר עם "נקודה")
      if (units !== null && !prefix) {
        const [whole, frac] = String(Number(units.toFixed(2))).split(".");
        prefix = frac ? `t-במערכת יש ${whole}.t-נקודה.t-${frac} יחידות.` : `t-במערכת יש ${whole} יחידות.`;
      }
      // מקום 6 = NO: בלי הקראת ההקשה. מקום 15 = no: בלי בקשת האישור של ימות המשיח (יש לנו אישור משלנו)
      return formatYemotResponse(`read=${prefix}t-הקישו טלפון או מקש מקוצר לפי התפריט, ולאחר כל בחירה הקישו סולמית, ${options}, ליציאה הקישו כוכבית=phone_number_to_validate,,10,1,,NO,,,,,,,,,no`);
    };

    // === מצב 2: הוקש מספר טלפון או מקש של מספר שמור ===
    if (activeParamName === "phone_number_to_validate") {
      // הערך האחרון שהוקש בתפריט (פרמטר שחוזר מחובר בפסיקים)
      let phoneNumber = (params.phone_number_to_validate || "").split(",").pop().trim();
      let chosenName = null;

      // כוכבית בתפריט - יציאה
      if (phoneNumber.includes("*")) {
        return formatYemotResponse("&");
      }

      if (savedNumbers.length > 0 && /^\d{1,3}$/.test(phoneNumber)) {
        const chosen = savedNumbers[parseInt(phoneNumber, 10) - 1];
        if (!chosen) return askForNumber("t-הבחירה לא קיימת.");
        phoneNumber = chosen.num;
        chosenName = chosen.name;
      } else if (savedNumbers.length > 0 && !/^\d{9,10}$/.test(phoneNumber)) {
        return askForNumber("t-המספר שהוקש אינו תקין.");
      } else if (savedNumbers.length > 0) {
        // מספר מלא שנמצא ברשימה - נגיד את השם
        chosenName = savedNumbers.find((x) => x.num === phoneNumber)?.name || null;
      }

      // --- אישור לפני שליחת השיחה (רק במצב רשימת מספרים שמורים) ---
      if (savedNumbers.length > 0) {
        const confirm = params.confirm_send ? params.confirm_send.split(",").pop().trim() : null;

        if (!confirm) {
          const target = chosenName
            ? `t-המערכת תשלח כעת שיחת אימות ל${chosenName}`
            : `t-המערכת תשלח כעת שיחת אימות למספר.d-${phoneNumber}`;
          return formatYemotResponse(`read=${target}.t-לאישור הקישו 1, לשינוי הקישו 2, ליציאה הקישו כוכבית=confirm_send,,1,,,NO,,,,12*,,,,,no`);
        }
        if (confirm === "2") return formatYemotResponse("go_to_folder=.");
        if (confirm !== "1") return formatYemotResponse("&");
      }

      const newReqId = await getNewReqId(activeToken, phoneNumber);
      if (!newReqId) return formatYemotResponse("id_list_message=t-אירעה שגיאה בשליחת הקוד&");

      sessionData = {
        reqId: newReqId,
        phone_number: phoneNumber,
        new_code_counter: 0,
        wrong_code_counter: 0,
      };
      await saveSessionFile(activeToken, fullFilePath, sessionData);

      const sentTo = chosenName ? `t-קוד אימות נשלח בשיחה ל${chosenName}` : "t-קוד אימות נשלח אליכם בשיחה";
      return formatYemotResponse(`read=${sentTo}.t-נא הקישו את הקוד.t-לשליחת קוד חדש הקישו כוכבית וסולמית=code_attempt_0_1,,8,1,1200,NO,,yes,,,,,,,no`);
    }

    // === מצב 0: כניסה ראשונית ===
    return askForNumber();
  },
};
