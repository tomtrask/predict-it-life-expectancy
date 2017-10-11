const predictIt = require('predict-it');
const fs = require("fs")
const moment = require("moment")
const csvWriter = require('csv-write-stream')

const JSON_FILE_NAME_ = "./predictit_markets.json"
const CSV_DATE_FMT_ = "MM/DD/YYYY"
const DECIMAL_TIME_FMT_ = "YYYYMMDDHHmmss"
const PRETTY_DATE_FMT_ = "YYYY-MM-DD"
const FRESHNESS_DATE_NAME_ = "freshUntil"

const done = (msg) => {
  console.log(msg)
  process.exit()
}

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

    const summary = {
      symbol: symbol,
      contractEndDate: contractEndDate.format(CSV_DATE_FMT_),
      daysRemaining: daysRemaining,
      probContractSurvival: survivalProb,
      probDaySurvival: dailySurvivalProb,
      probWeekSurvival: weeklySurvivalProb,
      deathDate: deathDate.format(CSV_DATE_FMT_)
    }

    console.log("Contract: "+symbol)
    console.log("  Contract end: "+contractEndDate.format(PRETTY_DATE_FMT_))
    console.log("  Days remaining: "+daysRemaining)
    console.log("  Last trade: $"+contract.LastTradePrice)
    console.log("  Weekly P(S): "+(100*weeklySurvivalProb).toFixed(1)+" %")
    console.log("  Life expectancy: "+deathDate.format(PRETTY_DATE_FMT_))
    if (deathDate < withinThreeMonths) {
      summary.note = "WITHIN 3 MONTHS"
      console.log("  WITHIN 3 MONTHS")
    } else if (deathDate < withinSixMonths) {
      summary.note = "WITHIN 6 MONTHS"
      console.log("  WITHIN 6 MONTHS")
    } else if (deathDate < withinTwelveMonths) {
      summary.note = "WITHIN 12 MONTHS"
      console.log("  WITHIN 12 MONTHS")
    }
    console.log(JSON.stringify(summary, {}, 4))
    console.log("")

    results.push(summary)
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
