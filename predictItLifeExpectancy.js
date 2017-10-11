const predictIt = require('predict-it');
const fs = require("fs")
const moment = require("moment")
const csvWriter = require('csv-write-stream')

const JSON_FILE_NAME_ = "./predictit_markets.json"
const CSV_DATE_FMT_ = "MM/DD/YYYY"
const DECIMAL_TIME_FMT_ = "YYYYMMDDHHmmss"
const PRETTY_DATE_FMT_ = "YYYY-MM-DD"
const FRESHNESS_DATE_NAME_ = "freshUntil";

// Closure
(function() {
  /**
   * Decimal adjustment of a number.
   *
   * @param {String}  type  The type of adjustment.
   * @param {Number}  value The number.
   * @param {Integer} exp   The exponent (the 10 logarithm of the adjustment base).
   * @returns {Number} The adjusted value.
   */
  function decimalAdjust(type, value, exp) {
    // If the exp is undefined or zero...
    if (typeof exp === 'undefined' || +exp === 0) {
      return Math[type](value);
    }
    value = +value;
    exp = +exp;
    // If the value is not a number or the exp is not an integer...
    if (value === null || isNaN(value) || !(typeof exp === 'number' && exp % 1 === 0)) {
      return NaN;
    }
    // If the value is negative...
    if (value < 0) {
      return -decimalAdjust(type, -value, exp);
    }
    // Shift
    value = value.toString().split('e');
    value = Math[type](+(value[0] + 'e' + (value[1] ? (+value[1] - exp) : -exp)));
    // Shift back
    value = value.toString().split('e');
    return +(value[0] + 'e' + (value[1] ? (+value[1] + exp) : exp));
  }

  // Decimal round
  if (!Math.round10) {
    Math.round10 = function(value, exp) {
      return decimalAdjust('round', value, exp);
    };
  }
  // Decimal floor
  if (!Math.floor10) {
    Math.floor10 = function(value, exp) {
      return decimalAdjust('floor', value, exp);
    };
  }
  // Decimal ceil
  if (!Math.ceil10) {
    Math.ceil10 = function(value, exp) {
      return decimalAdjust('ceil', value, exp);
    };
  }
})();

const fetchMarketList = () => {
  return new Promise((resolve, reject) => {
    fs.readFile(JSON_FILE_NAME_, "utf8", (err, data) => {
      if (err) {
        if (err.code == "ENOENT") {
          // This is where the initial, empty file is defined
          resolve({
            freshUntil: parseInt(moment(0).format(DECIMAL_TIME_FMT_)),
            symbolsOfInterest: [],
            marketsOfInterest: {}
          })
        } else {
          reject(err)
        }
      } else {
        resolve(JSON.parse(data))
      }
    })
  })
}

const writeMarketList = (data) => {
  fs.writeFile(JSON_FILE_NAME_, JSON.stringify(data, {}, 4))
}

const mergeNewMarkets = (fileSettings, newMarketData) => {
  let marketAbstracts = {}
  let marketAbstractsCount = 0
  let careAbout = {}
  let dontCareAbout = {}
  if (fileSettings.symbolsOfInterest) {
    fileSettings.symbolsOfInterest.forEach(contractName => {
      if (fileSettings.marketAbstracts[contractName]) {
        careAbout[contractName] = fileSettings.marketAbstracts[contractName]
      }
    })
  }
  let marketsOfInterest = {}
  newMarketData.forEach(market => {
    if (market.Contracts.length == 1 && market.Contracts[0].Status == "Open") {
      const contract = market.Contracts[0]
      marketAbstracts[contract.TickerSymbol] = {
        "id": contract.ID,
        "shortName": contract.ShortName,
        "ticker": contract.TickerSymbol,
        "url": contract.URL
      }
      if (careAbout[contract.TickerSymbol]) {
        marketsOfInterest[contract.TickerSymbol] = market
      }
      ++marketAbstractsCount
    }
  })
  // TODO: we should have a way of forcing service call if new SoI
  fileSettings.symbolsOfInterest = fileSettings.symbolsOfInterest.sort()
  fileSettings.marketsOfInterest = marketsOfInterest
  fileSettings.marketAbstracts = marketAbstracts
}


describeInterestingContracts = (symbols, marketMap) => {
  const writer = csvWriter() 
  const now = moment()
  const withinThreeMonths = moment().add(3,"months")
  const withinSixMonths = moment().add(6,"months")
  const withinTwelveMonths = moment().add(12,"months")

  const results = []

  symbols.forEach(symbol => {
    const market = marketMap[symbol]
    const contract = market.Contracts[0]
    const contractEndDate = moment(contract.DateEnd)
    const daysRemaining = contractEndDate.diff(now, "days")+1
    const survivalProb = contract.LastTradePrice
    const dailySurvivalProb = Math.exp(Math.log(survivalProb)/daysRemaining)
    const weeklySurvivalProb = Math.pow(dailySurvivalProb, 7)
    const lifeExpectation = Math.log(0.5)/Math.log(dailySurvivalProb)
    const deathDate = moment().add(lifeExpectation, "day")

    let note = ""
    if (deathDate < withinThreeMonths) {
      note = "WITHIN 3 MONTHS"
    } else if (deathDate < withinSixMonths) {
      note = "WITHIN 6 MONTHS"
    } else if (deathDate < withinTwelveMonths) {
      note = "WITHIN 12 MONTHS"
    }
    const summary = {
      symbol: symbol,
      contractEndDate: contractEndDate.format(CSV_DATE_FMT_),
      daysRemaining: daysRemaining,
      probContractSurvival: Math.round(survivalProb, -6),
      probDaySurvival: Math.round10(dailySurvivalProb, -6),
      probWeekSurvival: Math.round10(weeklySurvivalProb, -6),
      lifeRemaining: Math.round(lifeExpectation,1),
      deathDate: deathDate.format(CSV_DATE_FMT_),
      note: note
    }
    results.push(summary)
  })

  results.sort((a,b) => {
    return a.probDaySurvival - b.probDaySurvival
  })

  results.forEach(result => {
    console.log("Contract: "+result.symbol)
    console.log("  Contract end: "+result.contractEndDate)
    console.log("  Days remaining: "+result.daysRemaining)
    console.log("  Last trade: $"+result.probContractSurvival)
    console.log("  Weekly P(S): "+(100*result.probWeekSurvival).toFixed(1)+" %")
    console.log("  Life expectancy: "+result.deathDate)
    if (result.note) {
      console.log("  "+result.note)
    }
    console.log("")

  })

  writer.pipe(fs.createWriteStream('results.csv'))
  results.forEach(summary => {
    writer.write(summary)
  })
  writer.end()
  console.log("Results are inresults.csv")
}

const isSavedDatabaseIncomplete = (fileSettings) => {
  // some will return true if any element caused the loop to return true
  return fileSettings.symbolsOfInterest.some(symbol => {
    return !(symbol in fileSettings.marketsOfInterest)
  })
}

fetchMarketList().then(data => {
  const nowDecimal = parseInt(moment().format(DECIMAL_TIME_FMT_))

  if (data.freshUntil < nowDecimal || isSavedDatabaseIncomplete(data)) {
    let fileSettings = data
    console.log("HITTING SERVICE")
    return predictIt.all().then(data => {
      fileSettings.freshUntil = parseInt(moment().add(10,"minute")
          .format(DECIMAL_TIME_FMT_))
      mergeNewMarkets(fileSettings, data)
      return fileSettings
    })
  } else {
    console.log("Did NOT hit service")
    return data
  }
}).then((newFileSettings) => {
  describeInterestingContracts(newFileSettings.symbolsOfInterest,
      newFileSettings.marketsOfInterest)
  return newFileSettings
}).then((finalSettings) => {
  return writeMarketList(finalSettings)
}).then(() => {
  console.log("Post write clean up")
}).catch(err => {
  console.error("Error: "+err)
})
