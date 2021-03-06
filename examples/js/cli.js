"use strict";

//-----------------------------------------------------------------------------

const [processPath, , exchangeId, methodName, ... params] = process.argv.filter (x => !x.startsWith ('--'))
const verbose = process.argv.includes ('--verbose')
const cloudscrape = process.argv.includes ('--cloudscrape')
const cfscrape = process.argv.includes ('--cfscrape')
const poll = process.argv.includes ('--poll')
const loadMarkets = process.argv.includes ('--load-markets')

//-----------------------------------------------------------------------------

const ccxt         = require ('../../ccxt.js')
    , fs           = require ('fs')
    , path         = require ('path')
    , asTable      = require ('as-table')
    , util         = require ('util')
    , { execSync } = require ('child_process')
    , log          = require ('ololog').configure ({ locate: false })
    , { ExchangeError, NetworkError } = ccxt


//-----------------------------------------------------------------------------

require ('ansicolor').nice

//-----------------------------------------------------------------------------

process.on ('uncaughtException',  e => { log.bright.red.error (e); process.exit (1) })
process.on ('unhandledRejection', e => { log.bright.red.error (e); process.exit (1) })

//-----------------------------------------------------------------------------
// cloudscraper helper

const scrapeCloudflareHttpHeaderCookie = (url) =>

	(new Promise ((resolve, reject) => {

        const cloudscraper = require ('cloudscraper')
		return cloudscraper.get (url, function (error, response, body) {

			if (error) {

                log.red ('Cloudscraper error')
				reject (error)

			} else {

				resolve (response.request.headers)
			}
        })
    }))

const cfscrapeCookies = (url) => {

    const command = [
        `python -c "`,
        `import cfscrape; `,
        `import json; `,
        `tokens, user_agent = cfscrape.get_tokens('${url}'); `,
        `print(json.dumps({`,
            `'Cookie': '; '.join([key + '=' + tokens[key] for key in tokens]), `,
            `'User-Agent': user_agent`,
        `}));" 2> /dev/null`
    ].join ('')

    const output = execSync (command)
    return JSON.parse (output.toString ('utf8'))
}

//-----------------------------------------------------------------------------

const timeout = 30000
const exchange = new (ccxt)[exchangeId] ({ verbose, timeout })

//-----------------------------------------------------------------------------

// set up keys and settings, if any
const keysGlobal = path.resolve ('keys.json')
const keysLocal = path.resolve ('keys.local.json')

let globalKeysFile = fs.existsSync (keysGlobal) ? keysGlobal : false
let localKeysFile = fs.existsSync (keysLocal) ? keysLocal : globalKeysFile
let settings = localKeysFile ? (require (localKeysFile)[exchangeId] || {}) : {}

Object.assign (exchange, settings)

//-----------------------------------------------------------------------------

let printSupportedExchanges = function () {
    log ('Supported exchanges:', ccxt.exchanges.join (', ').green)
}

//-----------------------------------------------------------------------------

 function printUsage () {
    log ('This is an example of a basic command-line interface to all exchanges')
    log ('Usage: node', process.argv[1], 'id'.green, 'method'.yellow, '"param1" param2 "param3" param4 ...'.blue)
    log ('Examples:')
    log ('node', process.argv[1], 'okcoinusd fetchOHLCV BTC/USD 15m')
    log ('node', process.argv[1], 'bitfinex fetchBalance')
    log ('node', process.argv[1], 'kraken fetchOrderBook ETH/BTC')
    printSupportedExchanges ()
}

//-----------------------------------------------------------------------------

const printHumanReadable = (result) => {

    if (Array.isArray (result)) {

        let arrayOfObjects = (typeof result[0] === 'object')

        result.forEach (object => {
            if (arrayOfObjects)
                log ('-------------------------------------------')
            log (object)
        })

        if (arrayOfObjects)
            log (result.length > 0 ? asTable (result) : result)

    } else {

        log.maxDepth (10).maxArrayLength (1000) (result)
    }
}

//-----------------------------------------------------------------------------


async function main () {

    const requirements = exchangeId && methodName
    if (!requirements) {

        printUsage ()

    } else {

        let args = params.map (param => {
            if (param === 'undefined')
                return undefined
            if (param[0] === '{' || param[0] === '[')
                return JSON.parse (param)
            return param.match (/[a-zA-Z]/g) ? param : parseFloat (param)
        })

        const www = Array.isArray (exchange.urls.www) ? exchange.urls.www[0] : exchange.urls.www

        if (cloudscrape)
            exchange.headers = await scrapeCloudflareHttpHeaderCookie (www)

        if (cfscrape)
            exchange.headers = cfscrapeCookies (www)

        if (loadMarkets)
            await exchange.loadMarkets ()

        if (typeof exchange[methodName] === 'function') {

            log (exchange.id + '.' + methodName, '(' + args.join (', ') + ')')

            while (true) {

                try {

                    const result = await exchange[methodName] (... args)
                    printHumanReadable (result)

                } catch (e) {

                    if (e instanceof ExchangeError) {

                        log.red (e.constructor.name, e.message)

                    } else if (e instanceof NetworkError) {

                        log.yellow (e.constructor.name, e.message)

                    }

                    log.dim ('---------------------------------------------------')

                    // rethrow for call-stack // other errors
                    throw e

                }

                if (!poll)
                    break;
            }

        } else if (typeof exchange[methodName] === 'undefined') {

            log.red (exchange.id + '.' + methodName + ': no such property')

        } else {

            printHumanReadable (exchange[methodName])
        }
    }
}

//-----------------------------------------------------------------------------

main ()
