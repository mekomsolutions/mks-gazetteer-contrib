const fs = require('fs');
const parse = require('csv-parse');
const camelCase = require('camelcase');
const mkdirp = require('mkdirp');

const levelCol = 0;
const idCol = 1;
const enCol = 2;
const khCol = 3;
const parentIdCol = 4;

const GAZETTEER_FILE = "gazetteer.csv";
const TARGET_DIR = './target';

// One to many dictionaries with frequencies of translations
var khMap = {};
var enMap = {};

// One to one dictionaries based on most frequent occurrences
var khEnDic = {};
var enKhDic = {};
var messages = {};
var revMessages = {};

// The whole hierarchy segregated by levels
var hierarchy = {};

const ID = 'id';
const NAME = 'name';
const PARENT_ID = 'parentId';
const LEVEL = 'level';

const AH = "addresshierarchy"; 
const AH_PREFIX = AH + "."; 

const CAMBODIA = "cambodia";

const AH_FILE = AH + ".csv"; 
const MSG_KH_FILE = AH + "_km_KH.properties"; 
const MSG_EN_FILE = AH + "_en.properties"; 
const LOG_FILE = "log.txt";

var logString = "";  // this is for the log file

parse(fs.readFileSync(GAZETTEER_FILE), {}, function(err, recs) {
  mkdirp(TARGET_DIR, function(err) { 

    parseCsv(recs);

    fillOneToOneDictionary(khMap, khEnDic);
    // fillOneToOneDictionary(enMap, enKhDic);

    fillMessages(khEnDic, messages);

    createOutputFiles();  
  });
});

function parseCsv(recs) {
  recs.forEach( function(rec) {
    process(rec);
  });
}

function process(rec) {
  var level = rec[levelCol];
  var id = rec[idCol];
  var parentId = rec[parentIdCol];
  var kh = rec[khCol];
  var en = rec[enCol];
  
  addToOneToManyDictionary(kh, en, khMap);
  addToOneToManyDictionary(en, kh, enMap);

  processEntry(level, id, parentId, kh, hierarchy);
}

function processEntry(level, id, parentId, kh, hierarchy) {

  if (hierarchy[level] == null) {
    hierarchy[level] = {};
  }
  if (hierarchy[level][id] == null) {
    hierarchy[level][id] = {};
  }

  var entry = {};
  entry[ID] = id;
  entry[LEVEL] = level;
  entry[NAME] = kh;
  entry[PARENT_ID] = parentId;

  hierarchy[level][id] = entry;
}

function addToOneToManyDictionary(word, translation, map) {
  if (!(word in map)) {
    map[word] = {};
  }
  var weights = map[word];
  if (!(translation in weights)) {
    weights[translation] = 1;
  }
  else {
    weights[translation] = weights[translation] + 1; 
  }
  map[word] = weights;
}

function fillOneToOneDictionary(map, dic) { // 'tsl' stands for 'translation'

  for (word in map) {

    var tslWeights = map[word];
    if (Object.keys(tslWeights).length > 0) {

      var logInfo = "|";
      var bestTsl = "";
      var freq = 0;

      Object.keys(tslWeights).forEach( function(tsl) {
        if (tslWeights[tsl] > freq) {
          bestTsl = tsl;
          freq = tslWeights[tsl];
        }
        logInfo += "'" + tsl + "'(" + tslWeights[tsl] + ")"
        logInfo += "|"
      });
      dic[word] = bestTsl;
      if (Object.keys(tslWeights).length > 1) {
        logString += "WARNING,'" + word + "' was translated as '" + bestTsl + "'. The encountered translations were: " + logInfo + "\n";
      }
    }
  }
}

function fillMessages(dic, messages) {

  Object.keys(dic).forEach( function(word) {

    var tsl = dic[word];
    var msg = camelCase(tsl);
    if (msg.indexOf("'") !== -1) {
      logString += "INFO," + tsl + "' contained ' (quotes) and were removed." + "\n";
      var msg = msg.replace("'", "");
    }
    if (msg.indexOf("-") !== -1) {
      logString += "INFO," + tsl + "' contained - (dashes) and were removed." + "\n";
      var msg = msg.replace("-", "");
    }

    msg = AH_PREFIX + msg;

    var testMgs = msg;
    var sfx = 1;
    while (testMgs in messages) {
      testMgs = msg + "." + ++sfx;
      logString += "WARNING,'" + tsl + "' is the English translation for other Khmer names than '" + word + "', appending a suffix: " + testMgs + "\n";
    }
    msg = testMgs;
    messages[msg] = word;
    revMessages[word] = msg;
  });
}

function findParent(entry) {

  var parentLevel = "";
  switch(entry[LEVEL]) {
    case "Village":
      parentLevel = "Commune";
      break;
    case "Commune":
      parentLevel = "District";
      break;
    case "District":
      parentLevel = "Province";
      break;
    case "Province":
      return null;
  }

  var parentEntry = hierarchy[parentLevel][entry[PARENT_ID]];
  if (typeof parentEntry == 'undefined') {
    logString += "ERROR,No parent found for entry: " + JSON.stringify(entry) + "\n";
  }

  return parentEntry;
}

function buildAddressEntryCSVLine(entry) {

  var csvLine = "\n";
  while (entry !== null) {

    csvLine = revMessages[entry[NAME]] + csvLine;

    entry = findParent(entry);
    if (typeof entry == 'undefined') {
      return null;
    }

    csvLine = "," + csvLine;
  }

  csvLine = AH_PREFIX + CAMBODIA + csvLine; // there's a leading comma already, see end of while loop

  return csvLine;
}

function createOutputFiles() {

  // The address hierarchy CSV
  const lowestLevel = 'Village';
  var ahCsv = "";
  Object.keys(hierarchy[lowestLevel]).forEach( function(entryId) {
    var entry = hierarchy[lowestLevel][entryId];
    var csvLine = buildAddressEntryCSVLine(entry);
    if (csvLine !== null) { // null is returned when something was broken in the entry's hierarchy
      ahCsv += csvLine;
    }
  });
  fs.writeFileSync(TARGET_DIR + "/" + AH_FILE, ahCsv);

  // The i18n properties files
  var khProp = AH_PREFIX + CAMBODIA + "=ព្រះរាជាណាចក្រកម្ពុជា" + "\n";
  var enProp = AH_PREFIX + CAMBODIA + "=Kingdom of Cambodia" + "\n";
  Object.keys(messages).forEach( function(msg) {
    khProp += msg + "=" + messages[msg] + "\n";
    enProp += msg + "=" + khEnDic[messages[msg]] + "\n";
  });
  fs.writeFileSync(TARGET_DIR + "/" + MSG_KH_FILE, khProp);
  fs.writeFileSync(TARGET_DIR + "/" + MSG_EN_FILE, enProp);

  // The log file
  fs.writeFileSync(TARGET_DIR + "/" + LOG_FILE, logString);
}