import { useState, useEffect } from 'react';
import { useTranslation, Trans } from 'next-i18next'
import { useRouter } from 'next/router'
import Link from 'next/link'
import axios from 'axios'
import Image from 'next/image'
import Select from 'react-select'

import { useIsMobile } from "../utils/mobile"
import {
  server,
  devNet,
  typeNumberOnly,
  delay,
  isDomainValid,
  encode,
  networkId,
  floatToXlfHex,
  rewardRateHuman,
  encodeAddressR,
  isAddressValid
} from '../utils'
import { amountFormat, capitalize, duration } from '../utils/format'
import { payloadXummPost, xummWsConnect, xummCancel, xummGetSignedData } from '../utils/xumm'

import XummQr from "./Xumm/Qr"
import CheckBox from './UI/CheckBox'
import ExpirationSelect from './UI/ExpirationSelect'
import TargetTableSelect from './UI/TargetTableSelect'

const qr = "/images/qr.gif"
const ledger = '/images/ledger-large.svg'
const trezor = '/images/trezor-large.svg'
const ellipal = '/images/ellipal-large.svg'

const voteTxs = ['castVoteRewardDelay', 'castVoteRewardRate', 'castVoteHook', 'castVoteSeat']
const askInfoScreens = [...voteTxs, 'NFTokenAcceptOffer', 'NFTokenCreateOffer', 'NFTokenBurn', 'setDomain']
const noCheckboxScreens = [...voteTxs, 'setDomain']

export default function SignForm({ setSignRequest, setAccount, signRequest }) {
  const { t } = useTranslation()
  const router = useRouter()
  const isMobile = useIsMobile()

  const [screen, setScreen] = useState("choose-app")
  const [status, setStatus] = useState("")
  const [showXummQr, setShowXummQr] = useState(false)
  const [xummQrSrc, setXummQrSrc] = useState(qr)
  const [xummUuid, setXummUuid] = useState(null)
  const [expiredQr, setExpiredQr] = useState(false)
  const [agreedToRisks, setAgreedToRisks] = useState(false)
  const [hookData, setHookData] = useState({})
  const [seatData, setSeatData] = useState({})
  const [targetLayer, setTargetLayer] = useState(signRequest?.layer)
  const [erase, setErase] = useState(false)

  const [rewardRate, setRewardRate] = useState()
  const [rewardDelay, setRewardDelay] = useState()

  const xummUserToken = localStorage.getItem('xummUserToken')

  useEffect(() => {
    //deeplink doesnt work on mobiles when it's not in the onClick event
    if (!isMobile && signRequest?.wallet === "xumm") {
      XummTxSend()
    }
    setHookData({})
    setSeatData({})
    setErase(false)
    //eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signRequest])

  const saveAddressData = async (address) => {
    //&service=true&verifiedDomain=true&blacklist=true&payString=true&twitterImageUrl=true&nickname=true
    const response = await axios("v2/address/" + address + '?username=true&hashicon=true')
    if (response.data) {
      const { hashicon, username } = response.data;
      setAccount({ address, hashicon, username })
    } else {
      setAccount(null)
    }
  }

  const XummTxSend = () => {
    //default login 
    let tx = { TransactionType: "SignIn" }
    if (signRequest.request) {
      tx = signRequest.request
    }

    if (tx.TransactionType === "NFTokenAcceptOffer" && !agreedToRisks && signRequest.offerAmount !== "0") {
      setScreen("NFTokenAcceptOffer")
      return
    }

    if ((tx.TransactionType === "NFTokenCreateOffer" || tx.TransactionType === "URITokenCreateSellOffer") &&
      !agreedToRisks) {
      setScreen("NFTokenCreateOffer")
      return
    }

    if (tx.TransactionType === "NFTokenBurn" && !agreedToRisks) {
      setScreen("NFTokenBurn")
      return
    }

    if (signRequest.action === 'setDomain' && !agreedToRisks) {
      setScreen("setDomain")
      return
    }

    if (signRequest.action && voteTxs.includes(signRequest.action) && !agreedToRisks) {
      setScreen(signRequest.action)
      return
    }

    if (signRequest.action === 'castVoteHook' && agreedToRisks && (hookData.value || erase)) {
      tx.HookParameters = [
        {
          HookParameter:
          {
            HookParameterName: "4C",         // L - layer
            HookParameterValue: "0" + targetLayer  // 01 for L1 table, 02 for L2 table
          }
        },
        {
          HookParameter:
          {
            HookParameterName: "54",                             // T - topic type
            HookParameterValue: "480" + (hookData.topic || "2")  // H/48 [0x00-0x09]
          }
        },
        {
          HookParameter:
          {
            HookParameterName: "56", // V - vote data
            HookParameterValue: erase ? "0000000000000000000000000000000000000000000000000000000000000000" : hookData.value
          }
        }
      ]
    }

    if (signRequest.action === 'castVoteSeat' && agreedToRisks && (seatData.address || erase)) {
      tx.HookParameters = [
        {
          HookParameter:
          {
            HookParameterName: "4C",               // L - layer
            HookParameterValue: "0" + targetLayer  // 01 for L1 table, 02 for L2 table
          }
        },
        {
          HookParameter:
          {
            HookParameterName: "54",                           // T - topic type
            HookParameterValue: "53" + (seatData.seat || "13") // S - seat, seat number 0-13 (19)
          }
        },
        {
          HookParameter:
          {
            HookParameterName: "56", // V - vote data
            HookParameterValue: erase ? "0000000000000000000000000000000000000000" : encodeAddressR(seatData.address)
          }
        }
      ]
    }

    const client = {
      "Memo": {
        "MemoData": "626974686F6D702E636F6D"
      }
    }

    if (tx.Memos && tx.Memos.length && tx.Memos[0]?.Memo?.MemoData !== client.Memo.MemoData) {
      tx.Memos.push(client)
    } else {
      tx.Memos = [client]
    }

    tx.SourceTag = 42697468

    //add network ID to transactions for xahau-testnet and xahau
    if (networkId === 21338 || networkId === 21337) {
      tx.NetworkID = networkId
    }

    let signInPayload = {
      options: {
        expire: 3
      },
      txjson: tx
    }

    if (signRequest.redirect) {
      signInPayload.custom_meta = {
        blob: {
          redirect: signRequest.redirect
        }
      }
    }

    setStatus(t("signin.xumm.statuses.wait"))

    if (isMobile) {
      setStatus(t("signin.xumm.statuses.redirecting"));
      //return to the same page
      //you can add "?uuid={id}"
      signInPayload.options.return_url = {
        app: server + router.asPath
      }
      //for username receipts
      if (tx.TransactionType === "Payment") {
        signInPayload.options.return_url.app += '&receipt=true'
      }

      //app which signed
      //signInPayload.options.return_url.app += '&signed=xumm'
    } else {
      if (xummUserToken) {
        signInPayload.user_token = xummUserToken
      }
      setShowXummQr(true)
    }
    payloadXummPost(signInPayload, onPayloadResponse)
    setScreen("xumm")
  }

  const onPayloadResponse = data => {
    if (!data || data.error) {
      setShowXummQr(false);
      setStatus(data.error);
      return;
    }
    setXummUuid(data.uuid);
    setXummQrSrc(data.refs.qr_png);
    setExpiredQr(false);
    xummWsConnect(data.refs.websocket_status, xummWsConnected);
    if (data.pushed) {
      setStatus(t("signin.xumm.statuses.check-push"));
    }
    if (isMobile) {
      if (data.next && data.next.always) {
        window.location = data.next.always;
      } else {
        console.log("payload next.always is missing");
      }
    } else {
      setShowXummQr(true);
      setStatus(t("signin.xumm.scan-qr"));
    }
  }

  const xummWsConnected = obj => {
    if (obj.status === "canceled") {
      //cancel button pressed in xaman app
      closeSignInFormAndRefresh()
    } else if (obj.opened) {
      setStatus(t("signin.xumm.statuses.check-app"))
    } else if (obj.signed) {
      setShowXummQr(false)
      setStatus(t("signin.xumm.statuses.wait"))
      xummGetSignedData(obj.payload_uuidv4, afterSubmit)
    } else if (obj.expires_in_seconds) {
      if (obj.expires_in_seconds <= 0) {
        setExpiredQr(true)
        setStatus(t("signin.xumm.statuses.expired"))
      }
    }
  }

  const afterSubmit = async data => {
    /*
    {
      "application": {
        "issued_user_token": "xxx"
      },
      "response": {
        "hex": "xxx",
        "txid": "xxx",
        "environment_nodeuri": "wss://testnet.xrpl-labs.com",
        "environment_nodetype": "TESTNET",
        "account": "xxx",
        "signer": "xxx"
      }
    }
    */
    //data.payload.tx_type: "SignIn"

    //if redirect 
    if (data.response?.account) {
      saveAddressData(data.response.account)
      const redirectName = data.custom_meta?.blob?.redirect
      if (redirectName === "nfts") {
        window.location.href = server + "/nfts/" + data.response.account
      } else if (redirectName === "account") {
        window.location.href = server + "/explorer/" + data.response.account
      }
    }

    // For NFT transaction, lets wait for crawler to finish it's job
    if (data.payload?.tx_type.includes("NFToken")) {
      if (data.response?.txid) {
        const response = await axios("xrpl/transaction/" + data.response.txid)
        if (response.data) {
          const { validated, inLedger, ledger_index } = response.data
          const includedInLedger = inLedger || ledger_index
          if (validated && includedInLedger) {
            checkCrawlerStatus(includedInLedger)
          } else {
            //if not validated or if no ledger info received, delay for 3 seconds
            delay(3000, closeSignInFormAndRefresh)
          }
        } else {
          //if no info on transaction, delay 3 sec
          delay(3000, closeSignInFormAndRefresh)
        }
      } else {
        //if no tx data, delay 3 sec
        delay(3000, closeSignInFormAndRefresh)
      }
    } else {
      // no checks or delays for non NFT transactions
      closeSignInFormAndRefresh()
    }
  }

  const checkCrawlerStatus = async inLedger => {
    const crawlerResponse = await axios("v2/statistics/nftokens/crawler")
    if (crawlerResponse.data) {
      const { ledgerIndex } = crawlerResponse.data
      // if crawler 10 ledgers behind, update right away
      // the backend suppose to return info directly from ledger when crawler 30 seconds behind
      // othewrwise wait until crawler catch up with the ledger where this transaction was included
      if (ledgerIndex >= inLedger || (inLedger - 10) > ledgerIndex) {
        closeSignInFormAndRefresh()
      } else {
        //check again in 1 second if crawler ctached up with the ledger where transaction was included
        delay(1000, checkCrawlerStatus, inLedger)
      }
    }
  }

  const closeSignInFormAndRefresh = () => {
    setXummQrSrc(qr)
    setScreen("choose-app")
    setSignRequest(null)
  }

  const SignInCancelAndClose = () => {
    if (screen === 'xumm') {
      setXummQrSrc(qr);
      xummCancel(xummUuid);
    }
    setScreen("choose-app");
    setSignRequest(null);
  }

  // temporary styles while hardware wallets are not connected
  const notAvailable = (picture, name) => {
    const divStyle = {
      display: "inline-block",
      position: "relative",
      opacity: 0.5,
      pointerEvents: "none"
    }
    const spanStyle = {
      position: "absolute",
      width: '100%',
      bottom: "20px",
      left: 0,
      textAlign: "center"
    }
    return <div style={divStyle}>
      <img alt={name} className='signin-app-logo' src={picture} />
      <span style={spanStyle}>{t("signin.not-available")}</span>
    </div>
  }

  const buttonStyle = {
    margin: "0 10px"
  }

  const onAmountChange = e => {
    let newRequest = signRequest
    newRequest.request.Amount = (e.target.value * 1000000).toString()
    setSignRequest(newRequest)
  }

  const onDomainChange = e => {
    setStatus("")
    let newRequest = signRequest
    let domain = e.target.value
    domain = domain.trim()
    domain = String(domain).toLowerCase()
    if (isDomainValid(domain)) {
      newRequest.request.Domain = encode(domain)
      setSignRequest(newRequest)
      setAgreedToRisks(true)
    } else {
      setAgreedToRisks(false)
    }
  }

  const onRewardDelayChange = e => {
    setStatus("")
    let newRequest = signRequest
    let delay = e.target.value
    setRewardDelay(delay)
    delay = delay.trim()
    let n = Math.floor(Number(delay))
    if (n !== Infinity && String(n) === delay && n > 0) {
      newRequest.request.HookParameters = [
        {
          HookParameter:
          {
            HookParameterName: "4C",    // L - layer
            HookParameterValue: "01",   // 01 for L1 table, 02 for L2 table
          }
        },
        {
          HookParameter:
          {
            HookParameterName: "54",    // T - topic type
            HookParameterValue: "5244", // RD - Reward delay
          }
        },
        {
          HookParameter:
          {
            HookParameterName: "56",                  // V - vote data
            HookParameterValue: floatToXlfHex(delay), // "0000A7DCF750D554" - 60 seconds
          }
        }
      ]
      setSignRequest(newRequest)
      setAgreedToRisks(true)
    } else {
      setStatus("Delay should be a positive integer")
      setAgreedToRisks(false)
    }
  }

  const onRewardRateChange = e => {
    setStatus("")
    let newRequest = signRequest
    let rate = e.target.value
    setRewardRate(rate)
    rate = rate.trim()
    if (rate >= 0 && rate <= 1) {
      newRequest.request.HookParameters = [
        {
          HookParameter:
          {
            HookParameterName: "4C",    // L - layer
            HookParameterValue: "01",   // 01 for L1 table, 02 for L2 table
          }
        },
        {
          HookParameter:
          {
            HookParameterName: "54",    // T - topic type
            HookParameterValue: "5252", // RR - reward rate
          }
        },
        {
          HookParameter:
          {
            HookParameterName: "56",                  // V - vote data
            HookParameterValue: floatToXlfHex(rate),
          }
        }
      ]
      setSignRequest(newRequest)
      setAgreedToRisks(true)
    } else {
      setStatus("Rate should be a number from 0 to 1")
      setAgreedToRisks(false)
    }
  }

  const onExpirationChange = daysCount => {
    if (daysCount) {
      let newRequest = signRequest
      let myDate = new Date()
      myDate.setDate(myDate.getDate() + daysCount)
      newRequest.request.Expiration = Math.floor(myDate / 1000) - 946684800 //ripple epoch
      setSignRequest(newRequest)
    }
  }

  const onSeatSelect = data => {
    let seatObj = seatData
    seatObj.seat = data.value
    setSeatData(seatObj)
  }

  const onSeatValueChange = value => {
    setStatus("")
    setAgreedToRisks(false)
    if (!value) return
    if (!isAddressValid(value)) {
      setStatus("Invalid address")
      return
    }
    setAgreedToRisks(true)
    let seatObj = seatData
    seatObj.address = value
    setSeatData(seatObj)
  }

  const onPlaceSelect = topic => {
    let hookObj = hookData
    hookObj.topic = topic.value
    setHookData(hookObj)
  }

  const onHookValueChange = value => {
    setStatus("")
    setAgreedToRisks(false)
    if (!value) return
    if (value.length !== 64) {
      setStatus("Invalid Hook value")
      return
    }
    setAgreedToRisks(true)
    let hookObj = hookData
    hookObj.value = value
    setHookData(hookObj)
  }

  const onEraseCheck = () => {
    setStatus("")
    if (!erase) {
      setAgreedToRisks(true)
    } else {
      setAgreedToRisks(false)
    }
    setErase(!erase)
  }

  const xls35Sell = signRequest?.request?.TransactionType === "URITokenCreateSellOffer"

  return (
    <div className="sign-in-form">
      <div className="sign-in-body center">
        <div className='close-button' onClick={SignInCancelAndClose}></div>
        {askInfoScreens.includes(screen) ?
          <>
            <div className='header'>
              {screen === 'NFTokenBurn' && t("signin.confirm.nft-burn-header")}
              {screen === 'NFTokenAcceptOffer' &&
                (signRequest.offerType === 'buy' ?
                  t("signin.confirm.nft-accept-buy-offer-header")
                  :
                  t("signin.confirm.nft-accept-sell-offer-header")
                )
              }
              {screen === 'NFTokenCreateOffer' &&
                ((signRequest.request.Flags === 1 || xls35Sell) ?
                  t("signin.confirm.nft-create-sell-offer-header")
                  :
                  t("signin.confirm.nft-create-buy-offer-header")
                )
              }
              {screen === 'setDomain' && t("signin.confirm.set-domain")}
              {voteTxs.includes(screen) && "Cast a vote"}
            </div>

            {screen === 'NFTokenCreateOffer' &&
              <>
                {signRequest.broker?.nftPrice ?
                  <>
                    <p className='left' style={{ width: "360px", margin: "20px auto" }}>
                      You're making a counter offer, which should to be accepted automatically within 5 minutes.
                      If it's not accepted you can cancel it at any time.
                    </p>
                    <table style={{ textAlign: "left", margin: "20px auto", width: "360px" }}>
                      <tbody>
                        <tr>
                          <td>NFT price</td>
                          <td className='right'> {amountFormat(signRequest.broker.nftPrice)}</td>
                        </tr>
                        <tr>
                          <td>onXRP fee (1.5%)</td>
                          <td className='right'> {amountFormat(signRequest.broker?.fee)} </td>
                        </tr>
                        <tr>
                          <td>Total</td>
                          <td className='right'> <b>{amountFormat(signRequest.request.Amount)}</b></td>
                        </tr>
                      </tbody>
                    </table>
                  </>
                  :
                  <div className='center'>
                    <br />
                    <span className={xls35Sell ? 'halv xahOnly' : 'quarter xrpOnly'}>
                      <span className='input-title'>{t("signin.amount.set-price")}</span>
                      <input
                        placeholder={t("signin.amount.enter-amount")}
                        onChange={onAmountChange}
                        onKeyPress={typeNumberOnly}
                        className="input-text"
                        spellCheck="false"
                        maxLength="35"
                        min="0"
                        type="text"
                        inputMode="decimal"
                      />
                    </span>
                    {!xls35Sell &&
                      <span className='quarter'>
                        <span className='input-title'>{t("signin.expiration")}</span>
                        <ExpirationSelect onChange={onExpirationChange} />
                      </span>
                    }
                  </div>
                }
              </>
            }
            {screen === 'setDomain' &&
              <div className='center'>
                <br />
                <span className='halv'>
                  <span className='input-title'>{t("signin.set-account.domain")}</span>
                  <input
                    placeholder={t("signin.set-account.enter-domain")}
                    onChange={onDomainChange}
                    className="input-text"
                    spellCheck="false"
                  />
                </span>
              </div>
            }

            {screen === 'castVoteRewardDelay' &&
              <div className='center'>
                <br />
                <span className='halv'>
                  <span className='input-title'>Reward delay (in seconds)</span>
                  <input
                    placeholder="2600000"
                    onChange={onRewardDelayChange}
                    className="input-text"
                    spellCheck="false"
                    value={rewardDelay}
                  />
                </span>
                <div>
                  <br />
                  {status ?
                    <b className="orange">{status}</b>
                    :
                    rewardDelay ? <b>= {duration(t, rewardDelay, { seconds: true })}</b> : <br />
                  }
                </div>
              </div>
            }

            {screen === 'castVoteRewardRate' &&
              <div className='center'>
                <br />
                <span className='halv'>
                  <span className='input-title'>Reward rate (per month compounding)<br />A number from 0 to 1, where 1 would be 100%</span>
                  <input
                    placeholder="0.00333333333333333"
                    onChange={onRewardRateChange}
                    className="input-text"
                    spellCheck="false"
                    value={rewardRate}
                  />
                </span>
                <div>
                  <br />
                  {status ?
                    <b className="orange">{status}</b>
                    :
                    rewardRate ? <b>≈ {rewardRateHuman(rewardRate)}</b> : <br />
                  }
                </div>
              </div>
            }

            {screen === 'castVoteSeat' &&
              <div className='center'>
                <br />
                <div>
                  {signRequest.layer === 2 &&
                    <span className='quarter'>
                      <span className='input-title'>{t("signin.target-table")}</span>
                      <TargetTableSelect onChange={(layer) => setTargetLayer(layer)} layer={signRequest.layer} />
                    </span>
                  }
                  <span className={signRequest.layer === 2 ? 'quarter' : 'halv'}>
                    <span className='input-title'>Seat</span>
                    <Select
                      options={[
                        { value: "00", label: "0" },
                        { value: "01", label: "1" },
                        { value: "02", label: "2" },
                        { value: "03", label: "3" },
                        { value: "04", label: "4" },
                        { value: "05", label: "5" },
                        { value: "06", label: "6" },
                        { value: "07", label: "7" },
                        { value: "08", label: "8" },
                        { value: "09", label: "9" },
                        { value: "0A", label: "10" },
                        { value: "OB", label: "11" },
                        { value: "0C", label: "12" },
                        { value: "0D", label: "13" },
                        { value: "0E", label: "14" },
                        { value: "0F", label: "15" },
                        { value: "10", label: "16" },
                        { value: "11", label: "17" },
                        { value: "12", label: "18" },
                        { value: "13", label: "19" },
                      ]}
                      defaultValue={{ value: "13", label: "19" }}
                      onChange={onSeatSelect}
                      isSearchable={false}
                      className="simple-select"
                      classNamePrefix="react-select"
                      instanceId="seat-select"
                    />
                  </span>
                </div>

                <div className='terms-checkbox'>
                  <CheckBox checked={erase} setChecked={onEraseCheck}>
                    Vacate the seat
                  </CheckBox>
                </div>

                {!erase &&
                  <span className='halv'>
                    <span className='input-title'>Address</span>
                    <input
                      placeholder="Enter address"
                      onChange={e => onSeatValueChange(e.target.value)}
                      className="input-text"
                      spellCheck="false"
                    />
                  </span>
                }
                <div>
                  <br />
                  {status ? <b className="orange">{status}</b> : <br />}
                </div>
              </div>
            }

            {screen === 'castVoteHook' &&
              <div className='center'>
                <br />
                <div>
                  {signRequest.layer === 2 &&
                    <span className='quarter'>
                      <span className='input-title'>{t("signin.target-table")}</span>
                      <TargetTableSelect onChange={(layer) => setTargetLayer(layer)} layer={signRequest.layer} />
                    </span>
                  }
                  <span className={signRequest.layer === 2 ? 'quarter' : 'halv'}>
                    <span className='input-title'>Place</span>
                    <Select
                      options={[
                        { value: 0, label: "0" },
                        { value: 1, label: "1" },
                        { value: 2, label: "2" },
                        { value: 3, label: "3" },
                        { value: 4, label: "4" },
                        { value: 5, label: "5" },
                        { value: 6, label: "6" },
                        { value: 7, label: "7" },
                        { value: 8, label: "8" },
                        { value: 9, label: "9" }
                      ]}
                      defaultValue={{ value: 2, label: "2" }}
                      onChange={onPlaceSelect}
                      isSearchable={false}
                      className="simple-select"
                      classNamePrefix="react-select"
                      instanceId="hook-topic-select"
                    />
                  </span>
                </div>
                <div className='terms-checkbox'>
                  <CheckBox checked={erase} setChecked={onEraseCheck}>
                    Erase the hook
                  </CheckBox>
                </div>
                {!erase &&
                  <span className='halv'>
                    <span className='input-title'>Hook</span>
                    <input
                      placeholder="Enter hook value"
                      onChange={e => onHookValueChange(e.target.value)}
                      className="input-text"
                      spellCheck="false"
                    />
                  </span>
                }
                <div>
                  <br />
                  {status ? <b className="orange">{status}</b> : <br />}
                </div>
              </div>
            }

            {!noCheckboxScreens.includes(screen) &&
              <div className='terms-checkbox'>
                <CheckBox checked={agreedToRisks} setChecked={setAgreedToRisks} >
                  {screen === 'NFTokenBurn' ?
                    t("signin.confirm.nft-burn")
                    :
                    <>
                      {screen === 'NFTokenCreateOffer' &&
                        (signRequest.request.Flags === 1 || xls35Sell) ?
                        t("signin.confirm.nft-create-sell-offer")
                        :
                        <Trans i18nKey="signin.confirm.nft-accept-offer">
                          I admit that Bithomp gives me access to a decentralised marketplace, and it cannot verify or guarantee the authenticity and legitimacy of any NFTs.
                          I confirm that I've read the <Link href="/terms-and-conditions" target="_blank">Terms and conditions</Link>, and I agree with all the terms to buy, sell or use any NFTs on Bithomp.
                        </Trans>
                      }
                    </>
                  }
                </CheckBox>
              </div>
            }

            <br />
            <button type="button" className="button-action" onClick={SignInCancelAndClose} style={buttonStyle}>
              {t("button.cancel")}
            </button>
            <button type="button" className={"button-action" + (agreedToRisks ? "" : " disabled")} onClick={XummTxSend} style={buttonStyle}>
              {t("button.sign")}
            </button>
          </>
          :
          <>
            {screen === 'choose-app' ?
              <>
                <div className='header'>{t("signin.choose-app")}</div>
                <div className='signin-apps'>
                  <Image alt="xumm" className='signin-app-logo' src='/images/xumm-large.svg' onClick={XummTxSend} width={150} height={24} />
                  {signRequest.wallet !== "xumm" &&
                    <>
                      {notAvailable(ledger, "ledger")}
                      {notAvailable(trezor, "trezor")}
                      {notAvailable(ellipal, "ellipal")}
                    </>
                  }
                </div>
              </>
              :
              <>
                <div className='header'>
                  {signRequest?.request ? t("signin.sign-with") : t("signin.login-with")} {capitalize(screen)}
                </div>
                {screen === 'xumm' ?
                  <>
                    {!isMobile &&
                      <div className="signin-actions-list">
                        1. {t("signin.xumm.open-app")}<br />
                        {devNet ?
                          <>
                            2. {t("signin.xumm.change-settings")}<br />
                            3. {t("signin.xumm.scan-qr")}
                          </> :
                          <>
                            2. {t("signin.xumm.scan-qr")}
                          </>
                        }
                      </div>
                    }
                    <br />
                    {showXummQr ?
                      <XummQr expiredQr={expiredQr} xummQrSrc={xummQrSrc} onReset={XummTxSend} status={status} />
                      :
                      <div className="orange bold center" style={{ margin: "20px" }}>{status}</div>
                    }
                  </>
                  :
                  <>
                    <div className="orange bold center" style={{ margin: "20px" }}>{status}</div>
                  </>
                }
              </>
            }
          </>
        }
      </div>
    </div>
  )
}