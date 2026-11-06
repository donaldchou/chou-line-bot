<%
Response.Expires = 0
Response.CacheControl = "no-cache"
%>
<!-- #include file="suda_config.asp" -->
<!-- #include file="buyer_config.asp" -->
<!-- #include file="switch_config.asp" -->
<!-- #include file="line_config.asp" -->
<!-- #include file="orderno_config.asp" -->
<%
'==================================================================
' LINE 客服機器人 API（{{LABEL}}）：只給 chou-line-bot 呼叫
'  標頭 X-Line-Token＝LineToken("line")（LINE_API_KEY 簽章，300 秒內有效）
'  回應一律 HTTP 200＋純 ASCII JSON {"ok":true|false,...}（IIS 會用自己的錯誤頁蓋掉 4xx/5xx）
'  line_api.asp?a=products              商品、訂購開關
'  line_api.asp?a=quote   (POST)        試算：items=貨品編號:數量,…  pay=cod|atm|card
'  line_api.asp?a=create  (POST)        建立訂單（ref 相同不會重複建立）
'  line_api.asp?a=query   (POST)        name、phone 查訂購者的訂單（最近 10 筆）
'  line_api.asp?a=order&id=流水號        訂單內容＋託運單＋LINE 對應
'  line_api.asp?a=list    (POST)        管理後台：機器人建立的訂單（since＝起始日期，最多 100 筆）
'  line_api.asp?a=jpg&obt=託運單號        託運單照片（image/jpeg）
'  line_api.asp?a=notified (POST)       記錄已用 LINE 通知寄出：id、obts
'  文字參數：「x」＋UTF-16 hex（LineDec）
'==================================================================
Dim lnAct
lnAct = LCase(Request.QueryString("a") & "")

Sub LineOut(json)
	Response.ContentType = "application/json"
	Response.Write json
	Response.End
End Sub

Sub LineFail(msg)
	LineOut "{""ok"":false,""error"":" & LineJs(msg) & "}"
End Sub

If Not LineCheckToken(Request.ServerVariables("HTTP_X_LINE_TOKEN"), "line") Then LineFail "auth"

Dim conn
Set conn = SudaDbOpen()

'---------- 商品 ----------
Function LineProductRows()
	Dim rs
	LineProductRows = Empty
	Set rs = conn.Execute("SELECT productid, productname, newprice, picture FROM product ORDER BY productid")
	If Not rs.EOF Then LineProductRows = rs.GetRows()
	rs.Close
End Function

Function LinePayName(code)
	Select Case LCase(code & "")
		Case "atm": LinePayName = "匯款或ATM轉帳"
		Case "card": LinePayName = "刷卡繳費"
		Case Else: LinePayName = "貨到付款"
	End Select
End Function

'試算：items＝「貨品編號:數量,…」；回傳空字串＝成功，結果放在 lnQty（Dictionary 編號→數量）、lnBoxes、lnItems、lnShip、lnCod、lnLines（JSON 陣列內容）
Dim lnQty, lnBoxes, lnItems, lnShip, lnCod, lnLines
Function LineCalc(items, pay)
	Dim rows, parts, p, kv, k, n, i, found, re
	LineCalc = ""
	Set lnQty = Server.CreateObject("Scripting.Dictionary")
	lnBoxes = 0 : lnItems = 0 : lnShip = 0 : lnCod = 0 : lnLines = ""
	rows = LineProductRows()
	If Not IsArray(rows) Then
		LineCalc = "沒有商品資料"
		Exit Function
	End If
	Set re = New RegExp
	re.Pattern = "^[0-9]{1,3}$"
	parts = Split(items & "", ",")
	For Each p In parts
		If Trim(p) <> "" Then
			kv = Split(Trim(p), ":")
			If UBound(kv) <> 1 Then
				LineCalc = "品項格式錯誤"
				Exit Function
			End If
			k = Trim(kv(0))
			If Not re.Test(Trim(kv(1))) Then
				LineCalc = "數量要是 0～999 的整數"
				Exit Function
			End If
			n = CLng(Trim(kv(1)))
			found = False
			For i = 0 To UBound(rows, 2)
				If Trim(rows(0, i) & "") = k Then found = True
			Next
			If Not found Then
				LineCalc = "沒有這個商品：" & k
				Exit Function
			End If
			If n > 0 Then lnQty(k) = lnQty(k) + n
		End If
	Next
	For i = 0 To UBound(rows, 2)
		k = Trim(rows(0, i) & "")
		If lnQty.Exists(k) Then
			lnBoxes = lnBoxes + lnQty(k)
			lnItems = lnItems + lnQty(k) * CLng(rows(2, i))
			If lnLines <> "" Then lnLines = lnLines & ","
			lnLines = lnLines & "{""id"":" & LineJs(k) & ",""name"":" & LineJs(rows(1, i)) & ",""price"":" & CLng(rows(2, i)) & ",""qty"":" & lnQty(k) & "}"
		End If
	Next
	If lnBoxes = 0 Then
		LineCalc = "請至少訂購 1 盒"
		Exit Function
	End If
	lnShip = LineShip(lnBoxes)
	If LinePayName(pay) = "貨到付款" Then lnCod = LineCod(lnItems + lnShip)
End Function

Function LineCalcJson()
	LineCalcJson = """lines"":[" & lnLines & "],""boxes"":" & lnBoxes & ",""items"":" & lnItems & ",""ship"":" & lnShip & ",""cod"":" & lnCod & ",""total"":" & (lnItems + lnShip + lnCod)
End Function

'---------- 訂單內容（JSON 物件） ----------
Function LineMask(s)
	Dim t
	t = Trim(s & "")
	If Len(t) <= 1 Then
		LineMask = t
	ElseIf Len(t) = 2 Then
		LineMask = Left(t, 1) & "＊"
	Else
		LineMask = Left(t, 1) & String(Len(t) - 2, "＊") & Right(t, 1)
	End If
End Function

Function LineOrderJson(oid, full)
	Dim rs, j, boxes, itemsAmt, extraAmt, adj, ship, cod, its, r2, nm, rows, trk, tIdx, i, k, batch, wb, sid, st, stt, hasJpg, sched, isCancel, lk, buyer, bPhone
	LineOrderJson = ""
	Set rs = conn.Execute("SELECT * FROM Order_Nm WHERE orderid = " & CLng(oid))
	If rs.EOF Then
		rs.Close
		Exit Function
	End If
	buyer = Trim(rs("buyer_name") & "")
	bPhone = Trim(rs("buyer_phone") & "")
	If buyer = "" Then
		buyer = Trim(rs("username") & "")
		bPhone = Trim(rs("phone") & "")
	End If
	sched = rs("schedule") & ""
	j = "{""id"":" & CLng(oid) & ",""time"":" & LineDt(rs("time").Value) & ",""schedule"":" & LineJs(sched)
	j = j & ",""pay"":" & LineJs(rs("paymethod") & "")
	If full Then
		j = j & ",""buyer"":" & LineJs(buyer) & ",""buyerPhone"":" & LineJs(bPhone) & ",""recipient"":" & LineJs(Trim(rs("username") & ""))
	Else
		j = j & ",""buyer"":" & LineJs(LineMask(buyer)) & ",""recipient"":" & LineJs(LineMask(rs("username") & ""))
	End If
	If IsNumeric(rs("paymoney")) Then cod = CLng(rs("paymoney")) Else cod = 0
	rs.Close

	'品項
	its = ""
	boxes = 0
	itemsAmt = 0
	Set r2 = conn.Execute("SELECT n.prono, n.qty, n.dis_price, p.productname FROM Order_Ns n LEFT JOIN product p ON n.prono = p.productid WHERE n.orderid = " & CLng(oid) & " ORDER BY n.id")
	Do While Not r2.EOF
		nm = Trim(r2("productname") & "")
		If nm = "" Then nm = Trim(r2("prono") & "")
		If IsNumeric(r2("qty")) Then
			boxes = boxes + CLng(r2("qty"))
			If IsNumeric(r2("dis_price")) Then itemsAmt = itemsAmt + CLng(r2("qty")) * CLng(r2("dis_price"))
		End If
		If its <> "" Then its = its & ","
		its = its & "{""name"":" & LineJs(nm) & ",""qty"":" & LineNum(r2("qty")) & "}"
		r2.MoveNext
	Loop
	r2.Close
	extraAmt = ExtraTotal(conn, oid)
	adj = ExtraShipAdj(conn, oid)
	ship = LineShip(boxes) + adj
	j = j & ",""items"":[" & its & "],""extras"":" & LineJs(ExtraProductText(conn, oid)) & ",""boxes"":" & boxes
	j = j & ",""total"":" & (itemsAmt + extraAmt + ship + cod)

	'託運單（最近一次印單）＋寄送進度
	wb = ""
	rows = Empty
	On Error Resume Next
	rows = SudaWaybills(conn, oid)
	Err.Clear
	On Error GoTo 0
	If IsArray(rows) Then
		Set tIdx = Server.CreateObject("Scripting.Dictionary")
		trk = Empty
		On Error Resume Next
		trk = TrackRows(conn, oid)
		Err.Clear
		On Error GoTo 0
		If IsArray(trk) Then
			For k = 0 To UBound(trk, 2)
				tIdx(trk(TRACK_R_OBT, k) & "") = k
			Next
		End If
		batch = rows(SUDA_F_BATCH, 0)
		For i = 0 To UBound(rows, 2)
			If rows(SUDA_F_BATCH, i) = batch Then
				st = "" : stt = "null" : sid = ""
				If tIdx.Exists(rows(SUDA_F_OBT, i) & "") Then
					k = tIdx(rows(SUDA_F_OBT, i) & "")
					sid = trk(TRACK_R_SID, k) & ""
					st = trk(TRACK_R_STATUS, k) & ""
					stt = LineDt(trk(TRACK_R_TIME, k))
				End If
				hasJpg = (SudaFindPdf(SudaJpgName(rows, i)) <> "")
				If wb <> "" Then wb = wb & ","
				wb = wb & "{""obt"":" & LineJs(rows(SUDA_F_OBT, i) & "") & ",""pkg"":" & LineNum(rows(SUDA_F_PKG, i)) & ",""pkgTotal"":" & LineNum(rows(SUDA_F_PKGTOTAL, i))
				wb = wb & ",""product"":" & LineJs(rows(SUDA_F_PRODUCT, i) & "") & ",""printed"":" & LineDt(rows(SUDA_F_TIME, i))
				wb = wb & ",""statusId"":" & LineJs(sid) & ",""status"":" & LineJs(st) & ",""statusTime"":" & stt & ",""jpg"":" & LCase(CStr(hasJpg)) & "}"
			End If
		Next
	End If
	j = j & ",""waybills"":[" & wb & "]"

	If full Then
		lk = LineOrderLink(conn, oid)
		If IsArray(lk) Then
			j = j & ",""line"":{""uid"":" & LineJs(lk(0)) & ",""name"":" & LineJs(lk(1)) & ",""notified"":" & LineDt(lk(2)) & ",""count"":" & LineNum(lk(3)) & "}"
		Else
			j = j & ",""line"":null"
		End If
	End If
	LineOrderJson = j & "}"
End Function

Dim oJ
Select Case lnAct

Case "ping"
	LineOut "{""ok"":true,""sys"":" & LineJs(LINE_SYS) & "}"

Case "products"
	Dim pRows, pJ, pI, pOpen
	pOpen = SwPageOpen()
	pRows = LineProductRows()
	pJ = ""
	If IsArray(pRows) Then
		For pI = 0 To UBound(pRows, 2)
			If pJ <> "" Then pJ = pJ & ","
			pJ = pJ & "{""id"":" & LineJs(Trim(pRows(0, pI) & "")) & ",""name"":" & LineJs(pRows(1, pI) & "") & ",""price"":" & LineNum(pRows(2, pI)) & ",""picture"":" & LineJs(Trim(pRows(3, pI) & "")) & "}"
		Next
	End If
	LineOut "{""ok"":true,""sys"":" & LineJs(LINE_SYS) & ",""open"":" & LCase(CStr(pOpen)) & ",""closedMsg"":" & LineJs(Trim(SW_MSG1 & " " & SW_MSG2)) & ",""products"":[" & pJ & "]}"

Case "quote"
	Dim qErr
	qErr = LineCalc(Request.Form("items"), Request.Form("pay"))
	If qErr <> "" Then LineFail qErr
	LineOut "{""ok"":true," & LineCalcJson() & "}"

Case "create"
	Dim cRef, cRe, cRs, cErr, fBName, fBSex, fBPhone, fBPhone2, fBEmail, fSame, fRName, fRPhone, fRPhone2, fAddr, fArr, fPay, fMemo, fUid, fLName, hasBuyer, newId, insOk, tries, k2
	If Not SwPageOpen() Then LineFail "closed"
	cRef = Request.Form("ref") & ""
	Set cRe = New RegExp
	cRe.Pattern = "^[A-Za-z0-9_-]{8,40}$"
	If Not cRe.Test(cRef) Then LineFail "ref"
	If Not LineEnsure(conn) Then LineFail "無法建立 Line_Order 資料表"
	'同一個 ref 已建立過：回傳原訂單（不重複建立）
	Set cRs = conn.Execute("SELECT orderid FROM Line_Order WHERE ref = '" & cRef & "'")
	If Not cRs.EOF Then
		newId = CLng(cRs("orderid"))
		cRs.Close
		LineOut "{""ok"":true,""dup"":true,""orderId"":" & newId & "}"
	End If
	cRs.Close

	fBName = SudaSafeLeft(LineDec(Request.Form("b_name")), 20)
	fBSex = Request.Form("b_sex") & ""
	If fBSex <> "F" Then fBSex = "M"
	fBPhone = SudaSafeLeft(LineDec(Request.Form("b_phone")), 20)
	fBPhone2 = SudaSafeLeft(LineDec(Request.Form("b_phone2")), 20)
	fBEmail = SudaSafeLeft(LineDec(Request.Form("b_email")), 50)
	fSame = (Request.Form("same") = "1")
	fRName = SudaSafeLeft(LineDec(Request.Form("r_name")), 20)
	fRPhone = SudaSafeLeft(LineDec(Request.Form("r_phone")), 20)
	fRPhone2 = SudaSafeLeft(LineDec(Request.Form("r_phone2")), 20)
	fAddr = SudaSafeLeft(LineDec(Request.Form("addr")), 90)
	fArr = Request.Form("arrtime") & ""
	If fArr <> "FM" And fArr <> "NIGHT" Then fArr = "AM"
	fPay = LinePayName(Request.Form("pay"))
	fMemo = SudaSafeLeft(LineDec(Request.Form("memo")), 500)
	fUid = Request.Form("uid") & ""
	cRe.Pattern = "^U[0-9a-f]{32}$"
	If Not cRe.Test(fUid) Then LineFail "uid"
	fLName = SudaSafeLeft(LineDec(Request.Form("line_name")), 80)

	cErr = ""
	If fBName = "" Then
		cErr = "請填寫訂購者姓名"
	ElseIf fBPhone = "" Then
		cErr = "請填寫訂購者電話"
	ElseIf Not fSame And fRName = "" Then
		cErr = "請填寫收件者姓名"
	ElseIf Not fSame And fRPhone = "" Then
		cErr = "請填寫收件者電話"
	ElseIf fAddr = "" Then
		cErr = "請填寫收件者地址"
	End If
	If cErr = "" Then cErr = LineCalc(Request.Form("items"), Request.Form("pay"))
	If cErr <> "" Then LineFail cErr

	hasBuyer = BuyerEnsure(conn)
	WayEnsure conn
	'訂單流水號＝今天下一個號碼（例 261104001，見 orderno_config.asp）；撞號（同時有人下單）就重抓再試（同 nwdata.asp）
	insOk = False
	tries = 0
	Do
		tries = tries + 1
		newId = OrderNoNext(conn)
		If newId = 0 Then LineFail ORDERNO_FULL_MSG
		Set cRs = Server.CreateObject("ADODB.Recordset")
		cRs.Open "SELECT * FROM Order_Nm WHERE 1 = 0", conn, 1, 3
		cRs.AddNew
		cRs("orderid") = newId
		If fSame Then
			cRs("username") = fBName
			cRs("phone") = fBPhone
			If fBPhone2 = "" Then cRs("phone2") = " " Else cRs("phone2") = fBPhone2
		Else
			cRs("username") = fRName
			cRs("phone") = fRPhone
			If fRPhone2 = "" Then cRs("phone2") = " " Else cRs("phone2") = fRPhone2
			If hasBuyer Then
				cRs("buyer_name") = fBName
				cRs("buyer_phone") = fBPhone
				If fBPhone2 <> "" Then cRs("buyer_phone2") = fBPhone2
			Else
				fMemo = "[訂購者 " & fBName & " " & fBPhone & " " & fBPhone2 & "] " & fMemo
			End If
		End If
		cRs("sex") = fBSex
		If fBEmail = "" Then cRs("e_mail") = " " Else cRs("e_mail") = fBEmail
		cRs("addr") = fAddr
		cRs("zip") = " "
		If fArr = "AM" Then
			cRs("arrtime") = "早上08~12點"
		ElseIf fArr = "FM" Then
			cRs("arrtime") = "中午12~18點"
		Else
			cRs("arrtime") = "晚上18~22點"
		End If
		cRs("paymethod") = fPay
		cRs("paymoney") = lnCod
		cRs("schedule") = "新訂單---等待處理"
		cRs("time") = Now
		cRs("memo") = fMemo
		On Error Resume Next
		cRs("order_way") = "line訂購"
		cRs("order_way_note") = SudaSafeLeft("LINE " & fLName, WAY_NOTE_MAX)
		Err.Clear
		cRs.Update
		If Err.Number = 0 Then
			insOk = True
		Else
			Err.Clear
			cRs.CancelUpdate
			Err.Clear
		End If
		On Error GoTo 0
		cRs.Close
	Loop While (Not insOk) And (tries < 12)
	If Not insOk Then LineFail "訂單暫時無法建立，請稍後再試"

	'訂購明細：單價用目前售價
	Dim cRows, cI
	cRows = LineProductRows()
	Set cRs = Server.CreateObject("ADODB.Recordset")
	cRs.Open "SELECT * FROM Order_Ns WHERE 1 = 0", conn, 1, 3
	For cI = 0 To UBound(cRows, 2)
		k2 = Trim(cRows(0, cI) & "")
		If lnQty.Exists(k2) Then
			cRs.AddNew
			cRs("orderid") = newId
			cRs("prono") = k2
			cRs("qty") = lnQty(k2)
			cRs("dis_price") = CLng(cRows(2, cI))
			cRs.Update
		End If
	Next
	cRs.Close

	Set cRs = Server.CreateObject("ADODB.Recordset")
	cRs.Open "SELECT * FROM Line_Order WHERE 1 = 0", conn, 1, 3
	cRs.AddNew
	cRs("ref") = cRef
	cRs("orderid") = newId
	cRs("line_uid") = fUid
	cRs("line_name") = fLName
	cRs("created") = Now
	cRs("notify_count") = 0
	cRs.Update
	cRs.Close
	LineOut "{""ok"":true,""dup"":false,""orderId"":" & newId & "," & LineCalcJson() & "}"

Case "query"
	Dim qName, qPhone, qD, qRs, qHit, qJ, qN, qHas, qBn
	qName = LineDec(Request.Form("name"))
	qPhone = LineDigits(LineDec(Request.Form("phone")))
	If qName = "" And Len(qPhone) < 8 Then LineFail "請提供訂購者姓名或電話"
	qHas = BuyerEnsure(conn)
	'近半年（6 個月內）下單的訂單（2026-11-04 起同網站 queryorder.asp：資料庫已合併歷年訂單，更早的不讓客人查到）
	'另填訂購者的比對 buyer_*，同收件者的比對 username／phone（同 queryorder.asp）；姓名與電話都有填時兩個都要相符
	Dim qSince
	qSince = DateAdd("m", -6, Date)
	Set qRs = conn.Execute("SELECT orderid, username, phone, phone2, buyer_name, buyer_phone, buyer_phone2 FROM Order_Nm WHERE [time] >= #" & Year(qSince) & "/" & Month(qSince) & "/" & Day(qSince) & "# ORDER BY orderid DESC")
	qJ = ""
	qN = 0
	Do While Not qRs.EOF And qN < 10
		qBn = Trim(qRs("buyer_name") & "")
		Dim okN, okP
		If qBn <> "" Then
			okN = (qBn = qName)
			okP = (LineDigits(qRs("buyer_phone")) = qPhone Or LineDigits(qRs("buyer_phone2")) = qPhone)
		Else
			okN = (Trim(qRs("username") & "") = qName)
			okP = (LineDigits(qRs("phone")) = qPhone Or LineDigits(qRs("phone2")) = qPhone)
		End If
		If qName <> "" And qPhone <> "" Then
			qHit = okN And okP
		ElseIf qName <> "" Then
			qHit = okN
		Else
			qHit = okP
		End If
		If qHit Then
			If qJ <> "" Then qJ = qJ & ","
			qJ = qJ & LineOrderJson(CLng(qRs("orderid")), False)
			qN = qN + 1
		End If
		qRs.MoveNext
	Loop
	qRs.Close
	LineOut "{""ok"":true,""orders"":[" & qJ & "]}"

Case "order"
	oJ = LineOrderJson(SudaOrderNo(Request.QueryString("id")), True)
	If oJ = "" Then LineFail "找不到訂單"
	LineOut "{""ok"":true,""order"":" & oJ & "}"

Case "list"
	'管理後台：機器人建立的訂單（Line_Order），since＝yyyy/mm/dd 之後建立，新的在前，最多 100 筆
	Dim lSince, lRs, lJ, lN
	lSince = Request.Form("since") & ""
	If Not IsDate(lSince) Then lSince = DateAdd("d", -30, Date)
	lSince = CDate(lSince)
	If Not LineEnsure(conn) Then LineFail "無法建立 Line_Order 資料表"
	Set lRs = conn.Execute("SELECT orderid FROM Line_Order WHERE created >= #" & Year(lSince) & "/" & Month(lSince) & "/" & Day(lSince) & "# ORDER BY orderid DESC")
	lJ = ""
	lN = 0
	Do While Not lRs.EOF And lN < 100
		oJ = LineOrderJson(CLng(lRs("orderid")), True)
		If oJ <> "" Then
			If lJ <> "" Then lJ = lJ & ","
			lJ = lJ & oJ
			lN = lN + 1
		End If
		lRs.MoveNext
	Loop
	lRs.Close
	LineOut "{""ok"":true,""orders"":[" & lJ & "]}"

Case "jpg"
	Dim jObt, jRs, jOid, jRows, jI, jPath, jSt
	jObt = SudaObtNo(Request.QueryString("obt"))
	If jObt = "" Then LineFail "obt"
	Set jRs = conn.Execute("SELECT TOP 1 orderid FROM Order_Suda WHERE obt = '" & jObt & "'")
	If jRs.EOF Then
		jRs.Close
		LineFail "找不到託運單"
	End If
	jOid = CLng(jRs("orderid"))
	jRs.Close
	jRows = SudaWaybills(conn, jOid)
	jPath = ""
	For jI = 0 To UBound(jRows, 2)
		If jRows(SUDA_F_OBT, jI) & "" = jObt Then jPath = SudaFindPdf(SudaJpgName(jRows, jI))
	Next
	If jPath = "" Then LineFail "這張託運單還沒有產生照片"
	conn.Close
	Set jSt = Server.CreateObject("ADODB.Stream")
	jSt.Type = 1
	jSt.Open
	jSt.LoadFromFile jPath
	Response.ContentType = "image/jpeg"
	Response.BinaryWrite jSt.Read
	jSt.Close
	Response.End

Case "notified"
	Dim nId, nObts
	nId = SudaOrderNo(Request.Form("id"))
	nObts = Left(Replace(Request.Form("obts") & "", "'", ""), 255)
	If nId = 0 Then LineFail "id"
	If LineEnsure(conn) Then conn.Execute "UPDATE Line_Order SET notified = Now(), notify_count = IIf(IsNull(notify_count), 0, notify_count) + 1, notify_obts = '" & nObts & "' WHERE orderid = " & nId
	LineOut "{""ok"":true}"

Case Else
	LineFail "action"
End Select
%>
