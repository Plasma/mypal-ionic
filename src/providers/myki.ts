import { Injectable } from '@angular/core';
import { Http, Response, Headers, RequestOptionsArgs, URLSearchParams, RequestOptions } from '@angular/http';
import { ConfigProvider } from './config';
import { Observable } from 'rxjs/Rx';
import 'rxjs/add/operator/map';
import { Myki } from '../models/myki';
import { CustomURLEncoder } from '../models/customUrlEncoder';
import * as $ from "jquery";
import * as moment from 'moment';

@Injectable()
export class MykiProvider {

  // APi root for all requests
  apiRoot = "https://www.mymyki.com.au/NTSWebPortal/"
  errorUrl = `${this.apiRoot}ErrorPage.aspx`

  // holders for ASP.NET page state properties
  private lastViewState = "";
  private lastEventValidation = "";
  private username = "";
  private password = "";
  private demoMode = false;

  // initialize new myki account
  mykiAccount = new Myki.Account();
  activeCardId = '';

  constructor(
    public http: Http,
    public configProvider: ConfigProvider
  ) {
  }

  setActiveCard(id: string) {
    this.activeCardId = id;

    // if card isn't loaded yet, load it
    if (!this.activeCard().loaded)
      this.getCardDetails(this.activeCard())

    // if the history isn't loaded yet, load it
    if (!this.activeCard().transactionLoaded)
      this.getCardHistory(this.activeCard())

    // store last active card ID
    this.configProvider.activeCardSet(id)
  }

  activeCard() {
    if (this.activeCardId === '')
      return new Myki.Card;

    return this.mykiAccount.cards.find(x => x.id === this.activeCardId)
  }

  logout() {
    // clear saved login
    this.configProvider.loginForget()
  }

  reset() {
    // clear current state
    this.mykiAccount = new Myki.Account()
  }

  // log in to myki account
  login(username: string, password: string): Promise<Response> {
    // determine if we're in mock demo models
    if (username === 'demo' && password === 'demo') {
      this.demoMode = true;
      return this.mockHttpDelay(() => { this.mockLogin() })
    }

    // specify the login endpoint
    let loginUrl = `${this.apiRoot}login.aspx`;

    return new Promise((resolve, reject) => {
      // do a GET first to get the viewstate
      this.httpGetAsp(loginUrl).then(
        data => {
          // set up form fields
          const body = new URLSearchParams()
          body.set('ctl00$uxContentPlaceHolder$uxUsername', username)
          body.set('ctl00$uxContentPlaceHolder$uxPassword', password)
          body.set('ctl00$uxContentPlaceHolder$uxLogin', 'Login')

          // post form fields
          this.httpPostFormAsp(loginUrl, body).then(
            data => {
              // verify if we are actually logged in
              // successful login redirects us to the "Login-Services.aspx" page
              if (data.url !== `${this.apiRoot}Registered/MyMykiAccount.aspx?menu=My%20myki%20account`)
                return reject()

              // store the last username/password
              this.username = username;
              this.password = password;

              // scrape webpage
              let scraperJquery = this.jQueryHTML(data)

              // scrape account holder
              this.mykiAccount.holder = scraperJquery.find('#ctl00_uxContentPlaceHolder_uxUserName').text()

              return resolve();
            },
            error => {
              return reject();
            }
          )
        },
        error => {
          return reject()
        })
    })
  }

  // re-login
  // the myki session might have expired
  relogin() {
    this.login(this.username, this.password)
  }

  getAccountDetails() {
    // determine if we're in mock demo models
    if (this.demoMode) {
      return this.mockHttpDelay(() => { this.mockAccountDetails() })
    }

    // specify the login endpoint
    let accountUrl = `${this.apiRoot}Registered/MyMykiAccount.aspx`;

    return new Promise((resolve, reject) => {
      // do a GET first to get the viewstate
      this.httpGetAsp(accountUrl).then(
        data => {
          // check if we're redirected to error page
          if (data.url === this.errorUrl)
            return reject()

          // set up form fields
          const body = new URLSearchParams()
          body.set('ctl00$uxContentPlaceHolder$uxTimer', '')
          body.set('__ASYNCPOST', 'true')

          // post form fields
          this.httpPostFormAsp(accountUrl, body).then(
            data => {
              // scrape webpage
              let scraperJquery = this.jQueryHTML(data)

              // scrape active cards
              let activeCards = scraperJquery.find("#tabs-1 table tr").not(":first")

              // get card ids of active cards
              activeCards.each((index, elem) => {
                var cardJquery = $(elem)
                let cardId = cardJquery.find("td:nth-child(1)").text().trim();

                // create or update card
                let card = this.findOrInsertCardById(cardId)

                card.status = Myki.CardStatus.Active;
                card.holder = cardJquery.find("td:nth-child(2)").text().trim();

                // process money
                card.moneyBalance = parseFloat(cardJquery.find("td:nth-child(3)").text().trim().replace("$", ""));

                // process pass
                let passActive = cardJquery.find("td:nth-child(4)").text().trim();
                if (passActive !== '') {
                  card.passActive = passActive
                  card.passActiveEnabled = true
                  card.passActiveExpiry = moment(passActive.split('valid until ')[1], "D MMM YY").toDate()
                }
              })

              // scrape ianctive cards
              let inactiveCards = scraperJquery.find("#tabs-2 table tr").not(":first")

              // get card ids of active cards
              inactiveCards.each((index, elem) => {
                var cardJquery = $(elem)
                let cardId = cardJquery.find("td:nth-child(1)").text().trim();

                // create or update card
                let card = this.findOrInsertCardById(cardId)

                card.status = Myki.CardStatus.Replaced;
                card.holder = cardJquery.find("td:nth-child(2)").text().trim();
              })

              return resolve();
            },
            error => {
              return reject();
            }
          )
        },
        error => {
          return reject()
        })
    })
  }

  getCardDetails(card: Myki.Card, loadHistory: boolean = false) {
    // determine if we're in mock demo models
    if (this.demoMode) {
      return this.mockHttpDelay(() => { this.mockCardDetails(card) })
    }

    // specify the login endpoint
    let cardUrl = `${this.apiRoot}Registered/ManageMyCard.aspx`;

    return new Promise((resolve, reject) => {
      // do a GET first to get the viewstate
      this.httpGetAsp(cardUrl).then(
        data => {
          // check if we're redirected to error page
          if (data.url === this.errorUrl)
            return reject()

          // set up form fields
          const body = new URLSearchParams()
          body.set('ctl00$uxContentPlaceHolder$uxCardList', card.id)
          body.set('ctl00$uxContentPlaceHolder$uxGo', 'Go')

          // post form fields
          this.httpPostFormAsp(cardUrl, body).then(
            data => {
              // scrape webpage
              let scraperJquery = this.jQueryHTML(data)
              let cardTable = scraperJquery.find("#ctl00_uxContentPlaceHolder_uxCardDetailsPnl table");

              card.holder = cardTable.find("tr:nth-child(1) td:nth-child(2)").text().trim();
              card.setType(cardTable.find("tr:nth-child(2) td:nth-child(2)").text().trim());
              card.expiry = moment(cardTable.find("tr:nth-child(3) td:nth-child(2)").text().trim(), "D MMM YYYY").toDate();
              card.status = Myki.CardStatus[cardTable.find("tr:nth-child(4) td:nth-child(2)").text().trim()];
              card.moneyBalance = parseFloat(cardTable.find("tr:nth-child(5) td:nth-child(2)").text().trim().replace("$", ""));
              card.moneyTopupInProgress = parseFloat(cardTable.find("tr:nth-child(6) td:nth-child(2)").text().trim().replace("$", ""));
              card.moneyTotalBalance = parseFloat(cardTable.find("tr:nth-child(7) td:nth-child(2)").text().trim().replace("$", ""));

              // process pass
              let passActive = cardTable.find("tr:nth-child(8) td:nth-child(2)").text().trim();
              if (passActive !== '-') {
                card.passActive = passActive
                card.passActiveEnabled = true
                card.passActiveExpiry = moment(passActive.split('Valid to ')[1], "D MMM YYYY").toDate()
              }

              let passInactive = cardTable.find("tr:nth-child(9) td:nth-child(2)").text().trim();
              if (passInactive !== '-')
                card.passInactive = passInactive

              card.lastTransactionDate = moment(cardTable.find("tr:nth-child(10) td:nth-child(2)").text().trim(), "D MMM YYYY hh:mm:ss A").toDate();

              card.autoTopup = cardTable.find("tr:nth-child(11) td:nth-child(2) li#ctl00_uxContentPlaceHolder_ModifyAutoload").length > 0;

              // load card history?
              if (loadHistory)
                this.getCardHistory(card);

              // set loading state
              card.loaded = true;

              return resolve();
            },
            error => {
              return reject();
            }
          )
        },
        error => {
          return reject()
        })
    })
  }

  getCardHistory(card: Myki.Card) {
    // determine if we're in mock demo models
    if (this.demoMode) {
      return this.mockHttpDelay(() => { this.mockCardHistory(card) })
    }

    // specify the login endpoint
    let historyUrl = `${this.apiRoot}Registered/MYTransactionsInfo.aspx`;

    return new Promise((resolve, reject) => {
      // do a GET first to get the viewstate
      this.httpGetAsp(historyUrl).then(
        data => {
          // check if we're redirected to error page
          if (data.url === this.errorUrl)
            return reject()

          // set up form fields
          const body = new URLSearchParams()
          body.set('ctl00$uxContentPlaceHolder$uxCardList', card.id)
          body.set('ctl00$uxContentPlaceHolder$uxPageSize', '40')
          body.set('ctl00$uxContentPlaceHolder$uxFromDay', '0')
          body.set('ctl00$uxContentPlaceHolder$uxFromMonth', '0')
          body.set('ctl00$uxContentPlaceHolder$uxFromYear', '0')
          body.set('ctl00$uxContentPlaceHolder$uxToDay', '0')
          body.set('ctl00$uxContentPlaceHolder$uxToMonth', '0')
          body.set('ctl00$uxContentPlaceHolder$uxToYear', '0')
          body.set('ctl00$uxContentPlaceHolder$uxSelectNewCard', 'Go')

          // post form fields
          this.httpPostFormAsp(historyUrl, body).then(
            data => {
              // clear existing card history
              card.transactions = [];

              // scrape webpage
              let scraperJquery = this.jQueryHTML(data)

              let historyTable = scraperJquery.find("table#ctl00_uxContentPlaceHolder_uxMykiTxnHistory");

              // set loading state
              card.transactionLoaded = true;

              // check if any transction records existing
              // there is a table row with the CSS class "header"
              if (historyTable.find("tr.Header").length === -1)
                return resolve(); // no records exist, early exit

              // loop over each transaction row
              historyTable.find("tr").not(":first").each((index, elem) => {
                var transJquery = $(elem)
                let trans = new Myki.Transaction();

                // process date & time
                let date = transJquery.find("td:nth-child(1)").text().trim()
                let time = transJquery.find("td:nth-child(2)").text().trim()
                trans.dateTime = moment(`${date} ${time}`, "DD/MM/YYYY HH:mm:ss").toDate()

                // type
                trans.setType(transJquery.find("td:nth-child(3)").text().trim().replace("*", "")) // remove * from transaction type

                // service
                trans.setService(transJquery.find("td:nth-child(4)").text().trim())

                // zone
                trans.zone = transJquery.find("td:nth-child(5)").text().trim()

                // description
                trans.description = transJquery.find("td:nth-child(6)").text().trim()

                // credit
                let credit = transJquery.find("td:nth-child(7)").text().trim().replace("-", "").replace("$", "") // remove "-" for empty fields and "$"
                trans.credit = credit != "" ? parseFloat(credit) : null

                // debit
                let debit = transJquery.find("td:nth-child(8)").text().trim().replace("-", "").replace("$", "")
                trans.debit = debit != "" ? parseFloat(debit) : null

                // balance
                let moneyBalance = transJquery.find("td:nth-child(9)").text().trim().replace("-", "").replace("$", "")
                trans.moneyBalance = moneyBalance != "" ? parseFloat(moneyBalance) : null

                card.transactions.push(trans)

              })
              
              return resolve();
            },
            error => {
              return reject();
            }
          )
        },
        error => {
          return reject()
        })
    })
  }

  private httpGetAsp(url: string): Promise<Response> {
    // set up request options
    const options = new RequestOptions()
    options.withCredentials = true // set/send cookies

    return new Promise((resolve, reject) => {
      this.http.get(url, options).subscribe(
        data => {
          // update the page state
          this.storePageState(data);

          return resolve(data);
        },
        error => {
          return reject(error);
        }
      )
    })
  }

  private httpPostFormAsp(url: string, body?: URLSearchParams): Promise<Response> {
    // set up request headers
    let headers = new Headers()
    headers.append('Content-Type', 'application/x-www-form-urlencoded') // we're going to submit form data

    // set up request options
    const options = new RequestOptions()
    options.withCredentials = true // set/send cookies
    options.headers = headers

    // set up POST body
    const postBody = new URLSearchParams('', new CustomURLEncoder())
    postBody.set('__VIEWSTATE', this.lastViewState)
    postBody.set('__EVENTVALIDATION', this.lastEventValidation)
    // if we have any supplied body param, add it to our POST body
    if (body != null) {
      postBody.setAll(body)
    }

    return new Promise((resolve, reject) => {
      this.http.post(url, postBody.toString(), options).subscribe(
        data => {
          // update the page state
          this.storePageState(data);

          return resolve(data);
        },
        error => {
          return reject(error);
        }
      )
    })
  }

  private jQueryHTML(data: any): JQuery {
    let scraper = (<any>document).implementation.createHTMLDocument()
    scraper.body.innerHTML = data._body
    return $(scraper.body.children)
  }

  private storePageState(data: any) {
    let scraperJquery = this.jQueryHTML(data)
    this.lastViewState = scraperJquery.find('#__VIEWSTATE').val()
    this.lastEventValidation = scraperJquery.find('#__EVENTVALIDATION').val()
  }

  private findOrInsertCardById(cardId: string): Myki.Card {
    let cards = this.mykiAccount.cards;
    let oldCard = cards.findIndex(x => { return x.id === cardId })

    // if not found, create a new card and return index
    if (oldCard === -1) {
      let newCard = new Myki.Card();
      newCard.id = cardId;
      cards.push(newCard)
      return cards[cards.length - 1]
    }

    // if found, return index of existing card
    return cards[oldCard]
  }

  private mockHttpDelay(func) {
    return new Promise((resolve) => {
      setTimeout(() => {
        func()
        resolve()
      }, 1000)
    })
  }

  private mockLogin() {
    this.mykiAccount.holder = "Demo account"
  }

  private mockAccountDetails() {
    let card1 = this.findOrInsertCardById('308412345678901')
    card1.status = 0
    card1.holder = this.mykiAccount.holder
    card1.moneyBalance = 70.18
    card1.passActive = "7 days, \n Zone 1-Zone 2,\n valid until " + moment().add(2,'days').format("D MMM YY") + " 03:00:00 AM"
    card1.passActiveEnabled = true
    card1.passActiveExpiry = moment().add(2,'days').hours(3).toDate()

    let card2 = this.findOrInsertCardById('308412345678902')
    card2.status = 0
    card2.holder = this.mykiAccount.holder
    card2.moneyBalance = 0.5

    let card3 = this.findOrInsertCardById('308412345678903')
    card3.status = 1
    card3.holder = this.mykiAccount.holder
  }

  private mockCardDetails(card: Myki.Card) {
    switch (card.id) {
      case '308412345678901':
        card.loaded = true
        card.passActive = "7 days , Zone 1-Zone 2.Valid to " + moment().add(2,'days').format("D MMM YYYY") + " 03:00:00 AM"
        card.type = 0
        card.expiry = new Date("2020-01-04T14:00:00.000Z")
        card.moneyTopupInProgress = 0
        card.moneyTotalBalance = 70.18
        card.passInactive = ""
        card.lastTransactionDate = new Date("2017-02-14T00:25:47.000Z")
        card.autoTopup = true
        break;
      case '308412345678902':
        card.loaded = true
        card.type = 2
        card.expiry = new Date("2018-12-21T14:00:00.000Z")
        card.moneyTopupInProgress = 10
        card.moneyTotalBalance = 0.5
        card.lastTransactionDate = new Date("2017-01-02T23:11:24.000Z")
        break;
      case '308412345678903':
        card.loaded = true
        card.type = 0
        card.lastTransactionDate = new Date("2016-01-01T16:12:02.000Z")
        break;
      default:
        throw new Error('Invalid card')
    }
  }

  private mockCardHistory(card: Myki.Card) {
    card.transactionLoaded = true

    let stubTransactions: Array<Myki.Transaction> = JSON.parse('[{"dateTime":"2017-02-14T09:12:29.000Z","type":4,"service":1,"zone":"1","description":"Southern Cross Station","credit":2,"debit":null,"moneyBalance":70.18},{"dateTime":"2017-02-14T00:25:47.000Z","type":1,"service":1,"zone":"1/2","description":"Flinders Street Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-13T23:43:17.000Z","type":0,"service":1,"zone":"2","description":"Springvale Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-13T23:43:17.000Z","type":2,"service":1,"zone":"2","description":"Springvale Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-13T23:31:47.000Z","type":2,"service":0,"zone":"2","description":"Mulgrave,Route 813in","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-13T23:31:47.000Z","type":0,"service":0,"zone":"2","description":"Mulgrave,Route 813in","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-13T09:12:43.000Z","type":0,"service":1,"zone":"1","description":"Southern Cross Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-13T00:26:39.000Z","type":1,"service":1,"zone":"1","description":"Southern Cross Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-12T23:42:42.000Z","type":2,"service":1,"zone":"2","description":"Springvale Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-12T23:42:42.000Z","type":0,"service":1,"zone":"2","description":"Springvale Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-12T23:30:17.000Z","type":0,"service":0,"zone":"2","description":"Mulgrave,Route 813in","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-12T23:30:17.000Z","type":2,"service":0,"zone":"2","description":"Mulgrave,Route 813in","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-10T09:13:35.000Z","type":0,"service":1,"zone":"1","description":"Southern Cross Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-10T00:46:31.000Z","type":1,"service":1,"zone":"1","description":"Southern Cross Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-10T00:02:37.000Z","type":0,"service":1,"zone":"2","description":"Springvale Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-10T00:02:37.000Z","type":2,"service":1,"zone":"2","description":"Springvale Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-09T08:25:09.000Z","type":0,"service":1,"zone":"1","description":"Southern Cross Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-09T00:34:45.000Z","type":1,"service":1,"zone":"1","description":"Flinders Street Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-08T23:41:01.000Z","type":2,"service":1,"zone":"2","description":"Springvale Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-08T23:41:01.000Z","type":0,"service":1,"zone":"2","description":"Springvale Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-08T23:30:36.000Z","type":2,"service":0,"zone":"2","description":"Mulgrave,Route 813in","credit":null,"debit":4.1,"moneyBalance":70.18},{"dateTime":"2017-02-08T23:30:36.000Z","type":0,"service":0,"zone":"2","description":"Mulgrave,Route 813in","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-08T23:30:36.000Z","type":3,"service":5,"zone":"-","description":"7 Days  Zone 1-2 ($41.00)","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-08T09:05:41.000Z","type":0,"service":1,"zone":"1","description":"Southern Cross Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-08T00:33:26.000Z","type":1,"service":1,"zone":"1","description":"Southern Cross Station","credit":null,"debit":1.3,"moneyBalance":74.28},{"dateTime":"2017-02-07T23:40:12.000Z","type":0,"service":1,"zone":"2","description":"Springvale Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-07T23:40:12.000Z","type":2,"service":1,"zone":"2","description":"Springvale Station","credit":null,"debit":2.8,"moneyBalance":75.58},{"dateTime":"2017-02-07T23:28:41.000Z","type":0,"service":0,"zone":"2","description":"Mulgrave,Route 813in","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-07T23:28:41.000Z","type":2,"service":0,"zone":"2","description":"Mulgrave,Route 813in","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-07T09:28:47.000Z","type":0,"service":1,"zone":"1","description":"Southern Cross Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-07T00:26:07.000Z","type":1,"service":1,"zone":"1","description":"Southern Cross Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-06T23:37:58.000Z","type":0,"service":1,"zone":"2","description":"Springvale Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-06T23:37:58.000Z","type":2,"service":1,"zone":"2","description":"Springvale Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-06T23:29:04.000Z","type":2,"service":0,"zone":"2","description":"Mulgrave,Route 813in","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-06T23:29:04.000Z","type":0,"service":0,"zone":"2","description":"Mulgrave,Route 813in","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-06T08:35:46.000Z","type":0,"service":1,"zone":"1","description":"Southern Cross Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-06T00:29:18.000Z","type":1,"service":1,"zone":"1","description":"Southern Cross Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-05T23:43:38.000Z","type":0,"service":1,"zone":"2","description":"Springvale Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-05T23:43:38.000Z","type":2,"service":1,"zone":"2","description":"Springvale Station","credit":null,"debit":null,"moneyBalance":null},{"dateTime":"2017-02-05T23:25:19.000Z","type":0,"service":0,"zone":"2","description":"Mulgrave,Route 813in","credit":null,"debit":null,"moneyBalance":null}]')

    for (let stubTransaction of stubTransactions) {
      let transaction = new Myki.Transaction()
      for (let prop in stubTransaction) {
        if (prop === 'dateTime') {
          transaction.dateTime = new Date(stubTransaction.dateTime)
        }

        transaction[prop] = stubTransaction[prop];
      }
      card.transactions.push(transaction)
    }
  }
}
