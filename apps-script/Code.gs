// SFI CUSAT MOCK TEST Apps Script backend.
// Deploy as a Web App that executes as the owner. Requests must pass through
// the Vercel proxy, which supplies BACKEND_SECRET from server-side settings.

const SHEET_ID = '1pH0ukBsAX4JJVbdzHyWEqx99fsyOACcX7_EZS8ZNjic';
const PASSWORD_HASH_ITERATIONS = 600000;
const STUDENT_SESSION_MS = 8 * 60 * 60 * 1000;
const MODERATOR_SESSION_MS = 8 * 60 * 60 * 1000;
const ACTIVATION_TTL_MS = 20 * 60 * 1000;
const REGISTRATION_HEADERS = [
  'Timestamp', 'FullName', 'RollNumber', 'Email', 'Phone', 'Token',
  'PasswordHash', 'ActivationHash', 'ActivationSalt', 'ActivationExpiresAt'
];
const SESSION_HEADERS = ['Token', 'Role', 'CreatedAt', 'ExpiresAt', 'StudentToken'];
const MODERATOR_ACTIONS = new Set([
  'modSaveTest', 'modGetTests', 'modDeleteTest', 'modPublishTest',
  'modGetResults', 'modGetStudents'
]);
const STUDENT_ACTIONS = new Set([
  'getQuestions', 'startAttempt', 'saveResponse', 'submitAttempt', 'myResults'
]);

function doGet() {
  return jsonOut({ success: true, message: 'SFI CUSAT MOCK TEST API is running.' });
}

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!isGatewayAuthorized(data.gatewaySecret)) {
      return jsonOut({ success: false, message: 'Unauthorized gateway request.' });
    }
    const action = data.action;
    if (MODERATOR_ACTIONS.has(action) && !getValidSession(data.token, 'moderator')) {
      return jsonOut({ success: false, message: 'Unauthorized: Invalid or expired moderator session.' });
    }
    let student = null;
    if (STUDENT_ACTIONS.has(action)) {
      student = getStudentContext(data.token);
      if (!student) return jsonOut({ success: false, message: 'Unauthorized: Invalid or expired student session.' });
    }
    const handlers = {
      health: function () { return jsonOut({ success: true }); },
      register: handleRegister,
      requestStudentActivation: handleStudentActivationRequest,
      activateStudent: handleStudentActivation,
      getStudentCredential: handleStudentCredential,
      createStudentSession: handleCreateStudentSession,
      getModeratorCredential: handleModeratorCredential,
      createModeratorSession: handleCreateModeratorSession,
      sessionInfo: handleSessionInfo,
      logout: handleLogout,
      listTests: handleListTests,
      getQuestions: handleGetQuestions,
      startAttempt: function (d) { return handleStartAttempt(d, student); },
      saveResponse: function (d) { return handleSaveResponse(d, student); },
      submitAttempt: function (d) { return handleSubmitAttempt(d, student); },
      myResults: function (d) { return handleMyResults(d, student); },
      modLogin: handleModLogin,
      modSaveTest: handleModSaveTest,
      modGetTests: handleModGetTests,
      modDeleteTest: handleModDeleteTest,
      modPublishTest: handleModPublishTest,
      modGetResults: handleModGetResults,
      modGetStudents: handleModGetStudents
    };
    if (!handlers[action]) return jsonOut({ success: false, message: 'Unknown action: ' + String(action || '') });
    return handlers[action](data);
  } catch (error) {
    return jsonOut({ success: false, message: 'Server error: ' + error.message });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function isGatewayAuthorized(received) {
  const expected = PropertiesService.getScriptProperties().getProperty('BACKEND_SECRET');
  return !!expected && !!received && constantTimeEqual(String(expected), String(received));
}

function constantTimeEqual(left, right) {
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i++) {
    diff |= (left.charCodeAt(i % Math.max(1, left.length)) || 0) ^
      (right.charCodeAt(i % Math.max(1, right.length)) || 0);
  }
  return diff === 0;
}

function getSheet(name, headers) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (headers && headers.length) {
    const lastColumn = Math.max(sheet.getLastColumn(), 0);
    const existing = lastColumn
      ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String)
      : [];
    const missing = headers.filter(function (header) { return existing.indexOf(header) < 0; });
    if (!lastColumn) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold')
        .setBackground('#1a1a1a').setFontColor('#ffffff');
    } else if (missing.length) {
      sheet.getRange(1, lastColumn + 1, 1, missing.length).setValues([missing]);
      sheet.getRange(1, lastColumn + 1, 1, missing.length).setFontWeight('bold')
        .setBackground('#1a1a1a').setFontColor('#ffffff');
    }
  }
  return sheet;
}

function sheetToObjects(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  return values.slice(1).map(function (row) {
    const object = {};
    headers.forEach(function (header, index) { object[header] = row[index]; });
    return object;
  });
}

// Safe to rerun: only creates missing sheets and appends missing header cells.
// Existing registration, attempt, response, and result rows remain in place.
function setupDatabase() {
  getSheet('Registrations', REGISTRATION_HEADERS);
  getSheet('Tests', ['TestID', 'Title', 'Description', 'Duration', 'PosMarks', 'NegMarks', 'TotalMarks', 'Status', 'UpdatedAt']);
  getSheet('Questions', ['TestID', 'QID', 'Page', 'Type', 'Marks', 'NegMarks', 'Answer', 'Thumbnail']);
  getSheet('Attempts', ['AttemptID', 'Token', 'TestID', 'StartedAt', 'ExpiresAt', 'Status', 'Score', 'Correct', 'Wrong', 'Skipped']);
  getSheet('Responses', ['AttemptID', 'QuestionID', 'Response', 'SavedAt']);
  getSheet('Sessions', SESSION_HEADERS);
}

function normalizeRoll(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function newSalt() {
  return Utilities.getUuid().replace(/-/g, '');
}

function bytesToHex(bytes) {
  return bytes.map(function (byte) {
    return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function hexToBytes(hex) {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    let value = parseInt(hex.slice(i, i + 2), 16);
    if (value > 127) value -= 256;
    bytes.push(value);
  }
  return bytes;
}

function derivePasswordHash(password, saltHex, iterations) {
  const passwordBytes = Utilities.newBlob(password, 'text/plain').getBytes();
  const saltBytes = hexToBytes(saltHex).concat([0, 0, 0, 1]);
  let current = Utilities.computeHmacSha256Signature(saltBytes, passwordBytes);
  const result = current.slice();
  for (let round = 1; round < iterations; round++) {
    current = Utilities.computeHmacSha256Signature(current, passwordBytes);
    for (let i = 0; i < result.length; i++) {
      let value = ((result[i] + 256) % 256) ^ ((current[i] + 256) % 256);
      if (value > 127) value -= 256;
      result[i] = value;
    }
  }
  return bytesToHex(result);
}

function makePasswordHash(password) {
  const salt = newSalt();
  return 'pbkdf2-sha256$' + PASSWORD_HASH_ITERATIONS + '$' + salt + '$' +
    derivePasswordHash(password, salt, PASSWORD_HASH_ITERATIONS);
}

function isValidPasswordHash(encodedHash) {
  return /^pbkdf2-sha256\$600000\$[0-9a-f]{32}\$[0-9a-f]{64}$/i.test(String(encodedHash || ''));
}

function activationDigest(code, salt) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + '|' + code,
    Utilities.Charset.UTF_8
  );
  return bytesToHex(bytes);
}

function newToken(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '') +
    Utilities.getUuid().replace(/-/g, '');
}

function withScriptLock(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('The account service is busy. Please try again.');
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function findRegistrationsByRoll(rollNumber) {
  const sheet = getSheet('Registrations', REGISTRATION_HEADERS);
  return sheetToObjects(sheet).map(function (row, index) {
    return { row: row, rowNumber: index + 2 };
  }).filter(function (entry) {
    return normalizeRoll(entry.row.RollNumber) === rollNumber;
  });
}

function handleRegister(data) {
  const fullName = String(data.fullName || '').trim();
  const rollNumber = normalizeRoll(data.rollNumber);
  const email = normalizeEmail(data.email);
  if (!fullName || fullName.length > 120 || !rollNumber || rollNumber.length > 80 ||
      !validEmail(email) || !isValidPasswordHash(data.passwordHash)) {
    return jsonOut({
      success: false,
      message: 'Enter a valid full name, roll number, email, and password.'
    });
  }
  return withScriptLock(function () {
    const matches = findRegistrationsByRoll(rollNumber);
    if (matches.length) {
      return jsonOut({
        success: false,
        message: 'This roll number is already registered. Please sign in.'
      });
    }
    const sheet = getSheet('Registrations', REGISTRATION_HEADERS);
    const stableStudentToken = newToken('student');
    sheet.appendRow([
      new Date(), fullName, rollNumber, email, '', stableStudentToken,
      data.passwordHash, '', '', ''
    ]);
    const student = { fullName: fullName, rollNumber: rollNumber, email: email, role: 'student' };
    const sessionToken = createSession('student', stableStudentToken);
    return jsonOut({ success: true, message: 'Registered successfully.', sessionToken: sessionToken, student: student });
  });
}

function handleStudentCredential(data) {
  const rollNumber = normalizeRoll(data.rollNumber);
  if (!rollNumber) return jsonOut({ success: false, message: 'Invalid roll number or password.' });
  const matches = findRegistrationsByRoll(rollNumber);
  if (matches.length !== 1 || !isValidPasswordHash(matches[0].row.PasswordHash)) {
    return jsonOut({ success: false, message: 'Invalid roll number or password.' });
  }
  const account = matches[0].row;
  return jsonOut({
    success: true,
    credential: { passwordHash: String(account.PasswordHash), rollNumber: normalizeRoll(account.RollNumber) }
  });
}

function handleCreateStudentSession(data) {
  const matches = findRegistrationsByRoll(normalizeRoll(data.rollNumber));
  if (matches.length !== 1 || !isValidPasswordHash(matches[0].row.PasswordHash)) {
    return jsonOut({ success: false, message: 'Invalid roll number or password.' });
  }
  const account = matches[0].row;
  const sessionToken = createSession('student', account.Token);
  return jsonOut({
    success: true,
    sessionToken: sessionToken,
    student: {
      fullName: String(account.FullName || ''),
      rollNumber: normalizeRoll(account.RollNumber),
      email: normalizeEmail(account.Email),
      role: 'student'
    }
  });
}

function handleStudentActivationRequest(data) {
  const rollNumber = normalizeRoll(data.rollNumber);
  const email = normalizeEmail(data.email);
  if (!rollNumber || !validEmail(email)) {
    return jsonOut({ success: false, message: 'Enter your roll number and registered email.' });
  }
  const activation = withScriptLock(function () {
    const matches = findRegistrationsByRoll(rollNumber);
    if (matches.length !== 1) return null;
    const account = matches[0].row;
    if (normalizeEmail(account.Email) !== email || account.PasswordHash) return null;
    const salt = newSalt();
    const code = newToken('activate').replace(/_/g, '');
    const sheet = getSheet('Registrations', REGISTRATION_HEADERS);
    const hashColumn = REGISTRATION_HEADERS.indexOf('ActivationHash') + 1;
    const saltColumn = REGISTRATION_HEADERS.indexOf('ActivationSalt') + 1;
    const expiresColumn = REGISTRATION_HEADERS.indexOf('ActivationExpiresAt') + 1;
    sheet.getRange(matches[0].rowNumber, hashColumn).setValue(activationDigest(code, salt));
    sheet.getRange(matches[0].rowNumber, saltColumn).setValue(salt);
    sheet.getRange(matches[0].rowNumber, expiresColumn).setValue(Date.now() + ACTIVATION_TTL_MS);
    return { rowNumber: matches[0].rowNumber, email: normalizeEmail(account.Email), code: code };
  });
  if (activation) {
    try {
      MailApp.sendEmail({
        to: activation.email,
        subject: 'SFI CUSAT Mock Test account activation',
        body: 'Use this one-time code to activate your existing student account: ' +
          activation.code + '\n\nThe code expires in 20 minutes. If you did not request it, ignore this message.'
      });
    } catch (error) {
      withScriptLock(function () {
        const sheet = getSheet('Registrations', REGISTRATION_HEADERS);
        sheet.getRange(activation.rowNumber, REGISTRATION_HEADERS.indexOf('ActivationHash') + 1).clearContent();
        sheet.getRange(activation.rowNumber, REGISTRATION_HEADERS.indexOf('ActivationSalt') + 1).clearContent();
        sheet.getRange(activation.rowNumber, REGISTRATION_HEADERS.indexOf('ActivationExpiresAt') + 1).clearContent();
      });
      return jsonOut({ success: false, message: 'Activation email could not be sent. Please contact the administrator.' });
    }
  }
  return jsonOut({
    success: true,
    message: 'If these details match an account that needs activation, a code was sent to its registered email.'
  });
}

function handleStudentActivation(data) {
  const rollNumber = normalizeRoll(data.rollNumber);
  const email = normalizeEmail(data.email);
  const code = String(data.activationCode || '').trim();
  if (!rollNumber || !validEmail(email) || !code || !isValidPasswordHash(data.passwordHash)) {
    return jsonOut({ success: false, message: 'Enter your account details and activation code.' });
  }
  return withScriptLock(function () {
    const matches = findRegistrationsByRoll(rollNumber);
    if (matches.length !== 1) {
      return jsonOut({ success: false, message: 'The activation code is invalid or expired. Request a new code.' });
    }
    const entry = matches[0], account = entry.row;
    const expiresAt = Number(account.ActivationExpiresAt);
    if (normalizeEmail(account.Email) !== email || account.PasswordHash ||
        !account.ActivationHash || expiresAt <= Date.now() ||
        !constantTimeEqual(activationDigest(code, String(account.ActivationSalt || '')), String(account.ActivationHash))) {
      return jsonOut({ success: false, message: 'The activation code is invalid or expired. Request a new code.' });
    }
    const sheet = getSheet('Registrations', REGISTRATION_HEADERS);
    sheet.getRange(entry.rowNumber, REGISTRATION_HEADERS.indexOf('PasswordHash') + 1).setValue(data.passwordHash);
    sheet.getRange(entry.rowNumber, REGISTRATION_HEADERS.indexOf('ActivationHash') + 1).clearContent();
    sheet.getRange(entry.rowNumber, REGISTRATION_HEADERS.indexOf('ActivationSalt') + 1).clearContent();
    sheet.getRange(entry.rowNumber, REGISTRATION_HEADERS.indexOf('ActivationExpiresAt') + 1).clearContent();
    const sessionToken = createSession('student', account.Token);
    const student = {
      fullName: String(account.FullName || ''),
      rollNumber: normalizeRoll(account.RollNumber),
      email: normalizeEmail(account.Email),
      role: 'student'
    };
    return jsonOut({ success: true, sessionToken: sessionToken, student: student });
  });
}

function createSession(role, studentToken) {
  const sheet = getSheet('Sessions', SESSION_HEADERS);
  const now = Date.now();
  const ttl = role === 'moderator' ? MODERATOR_SESSION_MS : STUDENT_SESSION_MS;
  const token = newToken(role === 'moderator' ? 'mod' : 'student');
  sheet.appendRow([token, role, now, now + ttl, studentToken || '']);
  return token;
}

function getValidSession(token, requiredRole) {
  if (!token) return null;
  const sessions = sheetToObjects(getSheet('Sessions', SESSION_HEADERS));
  const session = sessions.find(function (row) {
    return String(row.Token) === String(token) && row.Role === requiredRole &&
      Number(row.ExpiresAt) > Date.now();
  });
  return session || null;
}

function getStudentContext(token) {
  const session = getValidSession(token, 'student');
  if (!session || !session.StudentToken) return null;
  const matches = sheetToObjects(getSheet('Registrations', REGISTRATION_HEADERS)).filter(function (row) {
    return String(row.Token) === String(session.StudentToken);
  });
  if (matches.length !== 1) return null;
  return { studentToken: String(session.StudentToken), account: matches[0] };
}

function handleSessionInfo(data) {
  const session = getValidSession(data.token, 'student') || getValidSession(data.token, 'moderator');
  if (!session) return jsonOut({ success: false, message: 'Session expired. Please sign in again.' });
  if (session.Role === 'moderator') {
    const email = PropertiesService.getScriptProperties().getProperty('MODERATOR_EMAIL') || '';
    const name = PropertiesService.getScriptProperties().getProperty('MODERATOR_NAME') || 'Moderator';
    return jsonOut({ success: true, user: { name: name, email: email, role: 'moderator' } });
  }
  const context = getStudentContext(data.token);
  if (!context) return jsonOut({ success: false, message: 'Session expired. Please sign in again.' });
  return jsonOut({
    success: true,
    user: {
      fullName: String(context.account.FullName || ''),
      rollNumber: normalizeRoll(context.account.RollNumber),
      email: normalizeEmail(context.account.Email),
      role: 'student'
    }
  });
}

function handleLogout(data) {
  if (!data.token) return jsonOut({ success: true });
  const sheet = getSheet('Sessions', SESSION_HEADERS);
  const rows = sheet.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === String(data.token)) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return jsonOut({ success: true });
}

// Admin setup: set MODERATOR_EMAIL and a temporary MODERATOR_PASSWORD in
// Script Properties, run this once in the Apps Script editor, then remove the
// temporary password property. Only the derived hash remains for sign-in.
function hashConfiguredModeratorPassword() {
  const properties = PropertiesService.getScriptProperties();
  const email = normalizeEmail(properties.getProperty('MODERATOR_EMAIL'));
  const password = properties.getProperty('MODERATOR_PASSWORD');
  if (!validEmail(email) || !password || password.length < 12) {
    throw new Error('Set a valid MODERATOR_EMAIL and a temporary password of at least 12 characters in Script Properties.');
  }
  properties.setProperty('MODERATOR_PASSWORD_HASH', makePasswordHash(password));
  properties.deleteProperty('MODERATOR_PASSWORD');
}

function authorizeActivationEmail() {
  // Run manually once in the editor to grant the owner Mail service access.
  const remaining = MailApp.getRemainingDailyQuota();
  Logger.log('Mail service authorized. Remaining daily recipient quota: ' + remaining);
}

function handleModLogin(data) {
  return jsonOut({ success: false, message: 'Use the Vercel moderator sign-in endpoint.' });
}

function handleModeratorCredential() {
  const properties = PropertiesService.getScriptProperties();
  const configuredEmail = normalizeEmail(properties.getProperty('MODERATOR_EMAIL'));
  const passwordHash = properties.getProperty('MODERATOR_PASSWORD_HASH');
  if (!configuredEmail || !isValidPasswordHash(passwordHash)) return jsonOut({ success: false, message: 'Moderator sign-in is not configured.' });
  return jsonOut({
    success: true,
    credential: {
      email: configuredEmail,
      name: properties.getProperty('MODERATOR_NAME') || 'Moderator',
      passwordHash: passwordHash
    }
  });
}

function handleCreateModeratorSession() {
  const properties = PropertiesService.getScriptProperties();
  const configuredEmail = normalizeEmail(properties.getProperty('MODERATOR_EMAIL'));
  const passwordHash = properties.getProperty('MODERATOR_PASSWORD_HASH');
  if (!configuredEmail || !isValidPasswordHash(passwordHash)) {
    return jsonOut({ success: false, message: 'Moderator sign-in is not configured. Contact the administrator.' });
  }
  const token = createSession('moderator', '');
  return jsonOut({
    success: true,
    sessionToken: token,
    user: {
      name: properties.getProperty('MODERATOR_NAME') || 'Moderator',
      email: configuredEmail,
      role: 'moderator'
    }
  });
}

function handleListTests() {
  const testSheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Tests');
  if (!testSheet) return jsonOut({ success: true, tests: [] });
  const tests = sheetToObjects(testSheet).filter(function (test) { return test.Status === 'Published'; });
  const questionSheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Questions');
  const questions = questionSheet ? sheetToObjects(questionSheet) : [];
  return jsonOut({
    success: true,
    tests: tests.map(function (test) {
      return {
        id: test.TestID,
        title: test.Title,
        description: test.Description || '',
        duration: Number(test.Duration),
        posMarks: Number(test.PosMarks),
        negMarks: Number(test.NegMarks),
        totalMarks: Number(test.TotalMarks || 0),
        questionCount: questions.filter(function (question) { return String(question.TestID) === String(test.TestID); }).length
      };
    })
  });
}

function handleGetQuestions(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const test = sheetToObjects(ss.getSheetByName('Tests')).find(function (row) {
    return String(row.TestID) === String(data.testId) && row.Status === 'Published';
  });
  if (!test) return jsonOut({ success: false, message: 'Published test not found.' });
  const questionSheet = ss.getSheetByName('Questions');
  const questions = questionSheet ? sheetToObjects(questionSheet).filter(function (question) {
    return String(question.TestID) === String(data.testId);
  }) : [];
  return jsonOut({
    success: true,
    questions: questions.map(function (question) {
      return {
        id: question.QID,
        page: question.Page,
        type: question.Type,
        marks: Number(question.Marks),
        negMarks: Number(question.NegMarks),
        thumbnail: question.Thumbnail
      };
    })
  });
}

function findAttemptRow(sheet, attemptId) {
  if (!sheet || sheet.getLastRow() < 2) return null;
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0].map(String);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][headers.indexOf('AttemptID')]) === String(attemptId)) {
      const object = {};
      headers.forEach(function (header, index) { object[header] = rows[i][index]; });
      return { rowNumber: i + 1, headers: headers, values: rows[i], data: object };
    }
  }
  return null;
}

function handleStartAttempt(data, student) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const test = sheetToObjects(ss.getSheetByName('Tests')).find(function (row) {
    return String(row.TestID) === String(data.testId) && row.Status === 'Published';
  });
  if (!test) return jsonOut({ success: false, message: 'Published test not found.' });
  const attemptId = newToken('attempt');
  const now = Date.now();
  const duration = Math.max(1, Number(test.Duration) || 60);
  getSheet('Attempts', ['AttemptID', 'Token', 'TestID', 'StartedAt', 'ExpiresAt', 'Status', 'Score', 'Correct', 'Wrong', 'Skipped'])
    .appendRow([attemptId, student.studentToken, data.testId, now, now + duration * 60000, 'in-progress', 0, 0, 0, 0]);
  return jsonOut({ success: true, attemptId: attemptId, expiresAt: now + duration * 60000 });
}

function handleSaveResponse(data, student) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const attemptSheet = ss.getSheetByName('Attempts');
  const attempt = findAttemptRow(attemptSheet, data.attemptId);
  if (!attempt || String(attempt.data.Token) !== student.studentToken ||
      attempt.data.Status !== 'in-progress' || Number(attempt.data.ExpiresAt) <= Date.now()) {
    return jsonOut({ success: false, message: 'Attempt not found, expired, or unauthorized.' });
  }
  const questions = sheetToObjects(ss.getSheetByName('Questions'));
  const validQuestion = questions.some(function (question) {
    return String(question.TestID) === String(attempt.data.TestID) &&
      String(question.QID) === String(data.questionId);
  });
  if (!validQuestion) return jsonOut({ success: false, message: 'Question not found for this attempt.' });
  const responseValue = String(data.response == null ? '' : data.response).slice(0, 200);
  const responseSheet = getSheet('Responses', ['AttemptID', 'QuestionID', 'Response', 'SavedAt']);
  const rows = responseSheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.attemptId) && String(rows[i][1]) === String(data.questionId)) {
      responseSheet.getRange(i + 1, 3).setValue(responseValue);
      responseSheet.getRange(i + 1, 4).setValue(Date.now());
      return jsonOut({ success: true });
    }
  }
  responseSheet.appendRow([data.attemptId, data.questionId, responseValue, Date.now()]);
  return jsonOut({ success: true });
}

function handleSubmitAttempt(data, student) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const attemptSheet = ss.getSheetByName('Attempts');
  const attempt = findAttemptRow(attemptSheet, data.attemptId);
  if (!attempt || String(attempt.data.Token) !== student.studentToken) {
    return jsonOut({ success: false, message: 'Attempt not found or unauthorized.' });
  }
  if (attempt.data.Status === 'submitted') {
    return jsonOut({ success: false, message: 'Attempt already submitted.' });
  }
  const testId = attempt.data.TestID;
  const questions = sheetToObjects(ss.getSheetByName('Questions')).filter(function (question) {
    return String(question.TestID) === String(testId);
  });
  const responseSheet = ss.getSheetByName('Responses');
  const responses = responseSheet ? sheetToObjects(responseSheet).filter(function (row) {
    return String(row.AttemptID) === String(data.attemptId);
  }) : [];
  const responseMap = {};
  responses.forEach(function (row) { responseMap[String(row.QuestionID)] = row.Response; });
  const test = sheetToObjects(ss.getSheetByName('Tests')).find(function (row) {
    return String(row.TestID) === String(testId);
  });
  const positiveMarks = Number(test && test.PosMarks) || 4;
  const negativeMarks = Number(test && test.NegMarks) || 1;
  let correct = 0, wrong = 0, skipped = 0, score = 0;
  questions.forEach(function (question) {
    const response = responseMap[String(question.QID)];
    if (response === undefined || response === null || response === '') { skipped++; return; }
    if (compareAnswer(question, response)) { correct++; score += positiveMarks; }
    else { wrong++; score -= negativeMarks; }
  });
  const headers = attempt.headers;
  const statusColumn = headers.indexOf('Status') + 1;
  attemptSheet.getRange(attempt.rowNumber, statusColumn).setValue('submitted');
  attemptSheet.getRange(attempt.rowNumber, headers.indexOf('Score') + 1, 1, 4)
    .setValues([[score, correct, wrong, skipped]]);
  return jsonOut({ success: true, score: score, correct: correct, wrong: wrong, skipped: skipped });
}

function compareAnswer(question, response) {
  if (question.Type === 'NAT') {
    const expected = parseFloat(String(question.Answer).trim());
    const actual = parseFloat(String(response).trim());
    return !isNaN(expected) && !isNaN(actual) && Math.abs(expected - actual) < 0.01;
  }
  if (question.Type === 'MSQ') {
    const expected = String(question.Answer || '').split(',').map(function (value) { return value.trim().toUpperCase(); }).filter(Boolean).sort().join(',');
    const actual = String(response).split(',').map(function (value) { return value.trim().toUpperCase(); }).filter(Boolean).sort().join(',');
    return expected === actual;
  }
  return String(question.Answer || '').trim().toUpperCase() === String(response).trim().toUpperCase();
}

function handleMyResults(data, student) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const attemptSheet = ss.getSheetByName('Attempts');
  if (!attemptSheet) return jsonOut({ success: true, results: [] });
  const tests = sheetToObjects(ss.getSheetByName('Tests'));
  const results = sheetToObjects(attemptSheet).filter(function (attempt) {
    return String(attempt.Token) === student.studentToken && attempt.Status === 'submitted';
  }).map(function (attempt) {
    const test = tests.find(function (row) { return String(row.TestID) === String(attempt.TestID); });
    return {
      attemptId: attempt.AttemptID,
      testTitle: test ? test.Title : '—',
      score: Number(attempt.Score || 0),
      correct: Number(attempt.Correct || 0),
      wrong: Number(attempt.Wrong || 0),
      skipped: Number(attempt.Skipped || 0),
      totalMarks: Number(test && test.TotalMarks || 0)
    };
  });
  return jsonOut({ success: true, results: results });
}

function handleModSaveTest(data) {
  if (!data.test || !data.test.id || !data.test.title) {
    return jsonOut({ success: false, message: 'Test details are required.' });
  }
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const testSheet = getSheet('Tests', ['TestID', 'Title', 'Description', 'Duration', 'PosMarks', 'NegMarks', 'TotalMarks', 'Status', 'UpdatedAt']);
  const questionSheet = getSheet('Questions', ['TestID', 'QID', 'Page', 'Type', 'Marks', 'NegMarks', 'Answer', 'Thumbnail']);
  const test = data.test;
  const questions = Array.isArray(test.questions) ? test.questions : [];
  const totalMarks = questions.reduce(function (sum, question) { return sum + Number(question.marks || 0); }, 0);
  const existing = sheetToObjects(testSheet).find(function (row) { return String(row.TestID) === String(test.id); });
  if (existing) {
    const rows = testSheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(test.id)) {
        testSheet.getRange(i + 1, 2, 1, 8).setValues([[
          test.title, test.description || '', test.duration, test.posMarks, test.negMarks,
          totalMarks, test.status, Date.now()
        ]]);
        break;
      }
    }
  } else {
    testSheet.appendRow([test.id, test.title, test.description || '', test.duration, test.posMarks, test.negMarks, totalMarks, test.status, Date.now()]);
  }
  const oldQuestions = questionSheet.getDataRange().getValues();
  for (let i = oldQuestions.length - 1; i >= 1; i--) {
    if (String(oldQuestions[i][0]) === String(test.id)) questionSheet.deleteRow(i + 1);
  }
  if (questions.length) {
    const newRows = questions.map(function (question) {
      return [test.id, question.id, question.page, question.type, question.marks, question.negMarks, question.answer, question.thumbnail || ''];
    });
    questionSheet.getRange(questionSheet.getLastRow() + 1, 1, newRows.length, 8).setValues(newRows);
  }
  return jsonOut({ success: true, message: 'Test saved successfully.' });
}

function handleModGetTests() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const testSheet = ss.getSheetByName('Tests');
  if (!testSheet) return jsonOut({ success: true, tests: [] });
  const tests = sheetToObjects(testSheet);
  const questionSheet = ss.getSheetByName('Questions');
  const questions = questionSheet ? sheetToObjects(questionSheet) : [];
  return jsonOut({
    success: true,
    tests: tests.map(function (test) {
      return Object.assign({}, test, {
        questionCount: questions.filter(function (question) { return String(question.TestID) === String(test.TestID); }).length
      });
    })
  });
}

function handleModDeleteTest(data) {
  // Archive only. Keep questions, attempts, responses, registrations, and results.
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Tests');
  if (!sheet) return jsonOut({ success: false, message: 'Tests sheet not found.' });
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.testId)) {
      sheet.getRange(i + 1, 8).setValue('Archived');
      sheet.getRange(i + 1, 9).setValue(Date.now());
      return jsonOut({ success: true, message: 'Test archived. Existing results were preserved.' });
    }
  }
  return jsonOut({ success: false, message: 'Test not found.' });
}

function handleModPublishTest(data) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Tests');
  if (!sheet) return jsonOut({ success: false, message: 'Tests sheet not found.' });
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.testId)) {
      sheet.getRange(i + 1, 8).setValue(data.publish ? 'Published' : 'Draft');
      sheet.getRange(i + 1, 9).setValue(Date.now());
      return jsonOut({ success: true });
    }
  }
  return jsonOut({ success: false, message: 'Test not found.' });
}

function handleModGetResults() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const attemptSheet = ss.getSheetByName('Attempts');
  if (!attemptSheet) return jsonOut({ success: true, results: [] });
  const attempts = sheetToObjects(attemptSheet).filter(function (attempt) { return attempt.Status === 'submitted'; });
  const registrations = sheetToObjects(ss.getSheetByName('Registrations'));
  const tests = sheetToObjects(ss.getSheetByName('Tests'));
  return jsonOut({
    success: true,
    results: attempts.map(function (attempt) {
      const student = registrations.find(function (row) { return String(row.Token) === String(attempt.Token); });
      const test = tests.find(function (row) { return String(row.TestID) === String(attempt.TestID); });
      return {
        fullName: student ? student.FullName : '—',
        rollNumber: student ? student.RollNumber : '—',
        testTitle: test ? test.Title : '—',
        score: Number(attempt.Score || 0),
        correct: Number(attempt.Correct || 0),
        wrong: Number(attempt.Wrong || 0),
        skipped: Number(attempt.Skipped || 0),
        totalMarks: Number(test && test.TotalMarks || 0)
      };
    })
  });
}

function handleModGetStudents() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Registrations');
  if (!sheet) return jsonOut({ success: true, students: [] });
  const students = sheetToObjects(sheet).map(function (student) {
    return {
      FullName: student.FullName,
      RollNumber: student.RollNumber,
      Email: student.Email,
      Phone: student.Phone,
      Timestamp: student.Timestamp
    };
  });
  return jsonOut({ success: true, students: students });
}
