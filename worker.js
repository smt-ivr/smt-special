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

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // כמו ב-Netlify: פרמטר שמופיע כמה פעמים מחובר בפסיקים
    const params = {};
    for (const [k, v] of url.searchParams.entries()) {
      params[k] = k in params ? `${params[k]},${v}` : v;
    }

    let { token, ApiCallId, ApiExtension, username, password } = params;
    let activeToken = token;

    // --- שלב 0: בדיקות מקדימות ---
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
    const [tokenData, loadedSession] = await Promise.all([
      fetchApiData(`${YEMOT_API_BASE}/MFASession`, "get", { token: activeToken, action: "isPass" }),
      loadSessionFile(activeToken, fullFilePath),
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

        const nextVarName = `code_attempt_${sessionData.new_code_counter}_1`;
        return formatYemotResponse(`read=t-קוד אימות נוסף נשלח אליכם.t-נא הקישו את הקוד=${nextVarName},,8,1,1200,Digits,,yes`);
      }

      // --- בדיקת הקוד ---
      const validationResult = await validateCode(activeToken, sessionData.reqId, activeParamValue);

      if (validationResult === true) {
        return formatYemotResponse("id_list_message=t-האימות בוצע בהצלחה&");
      }

      sessionData.wrong_code_counter = current_wrong_counter;
      await saveSessionFile(activeToken, fullFilePath, sessionData);

      const nextVarName = `code_attempt_${current_new_counter}_${current_wrong_counter + 1}`;
      return formatYemotResponse(`read=t-הקוד שגוי.t-נא הקישו שוב את הקוד.t-לשליחת קוד חדש הקישו כוכבית וסולמית=${nextVarName},,8,1,1200,Digits,,yes`);
    }

    // === מצב 2: הוקש מספר טלפון ===
    if (activeParamName === "phone_number_to_validate") {
      const newReqId = await getNewReqId(activeToken, activeParamValue);
      if (!newReqId) return formatYemotResponse("id_list_message=t-אירעה שגיאה בשליחת הקוד&");

      sessionData = {
        reqId: newReqId,
        phone_number: activeParamValue,
        new_code_counter: 0,
        wrong_code_counter: 0,
      };
      await saveSessionFile(activeToken, fullFilePath, sessionData);

      return formatYemotResponse(`read=t-קוד אימות נשלח אליכם בשיחה.t-נא הקישו את הקוד.t-לשליחת קוד חדש הקישו כוכבית וסולמית=code_attempt_0_1,,8,1,1200,Digits,,yes`);
    }

    // === מצב 0: כניסה ראשונית ===
    return formatYemotResponse(`read=t-מחובר למערכת.t-נא הקישו את מספר הטלפון לאימות ולסיום הקישו סולמית=phone_number_to_validate,,10,9,,Phone`);
  },
};
