<%
'==================================================================
' LINE 客服機器人（chou-line-bot）串接設定與共用函式（{{LABEL}}）
'  由 line_api.asp、line_token.asp、vieworder_suda.asp 引用（需先引用 suda_config.asp）
'  line_api.asp ：機器人（Vercel）呼叫本主機：查商品、試算、建立訂單、查訂單、取託運單照片
'  vieworder_suda.asp 的「LINE 通知客人寄出」：管理者的瀏覽器帶通行證呼叫機器人
'    （本主機連不上 Vercel 的 TLS，同 partner_config.asp 的作法）
'  資料表 Line_Order：機器人建立的訂單與 LINE 使用者的對應（首次使用自動建立）
'==================================================================
Const LINE_SYS = "{{SYS}}"
Const LINE_API_KEY = "{{KEY}}"
Const LINE_BOT_SITE = "https://chou-line-bot.vercel.app"
Const LINE_TOKEN_SEC = 300

'運費與貨到付款手續費（同後台）
Function LineShip(boxes)
	LineShip = {{SHIP}}(boxes)
End Function
Function LineCod(amount)
	LineCod = {{COD}}(amount)
End Function

'HMAC-SHA256(LINE_API_KEY, msg) 的 hex；主機沒有 .NET 加密元件時回傳空字串
Function LineHmac(msg)
	Dim enc, h, b, i, s
	LineHmac = ""
	On Error Resume Next
	Set enc = Server.CreateObject("System.Text.UTF8Encoding")
	Set h = Server.CreateObject("System.Security.Cryptography.HMACSHA256")
	h.Key = enc.GetBytes_4(LINE_API_KEY)
	b = h.ComputeHash_2(enc.GetBytes_4(msg))
	If Err.Number <> 0 Then
		Err.Clear
		On Error GoTo 0
		Exit Function
	End If
	On Error GoTo 0
	s = ""
	For i = 1 To LenB(b)
		s = s & Right("0" & LCase(Hex(AscB(MidB(b, i, 1)))), 2)
	Next
	LineHmac = s
End Function

'UTC 秒數（台灣沒有日光節約時間：UTC＝本地時間－8 小時）
Function LineNowSec()
	LineNowSec = DateDiff("s", #1970/1/1#, DateAdd("h", -8, Now))
End Function

'通行證「秒數.簽章」，簽章＝HMAC(purpose & ":" & 秒數)
Function LineToken(purpose)
	Dim ts, s
	ts = LineNowSec()
	s = LineHmac(purpose & ":" & ts)
	If s = "" Then LineToken = "" Else LineToken = ts & "." & s
End Function

'檢查通行證（LINE_TOKEN_SEC 秒內有效）
Function LineCheckToken(tok, purpose)
	Dim p, ts, re
	LineCheckToken = False
	p = Split(tok & "", ".")
	If UBound(p) <> 1 Then Exit Function
	Set re = New RegExp
	re.Pattern = "^[0-9]{9,11}$"
	If Not re.Test(p(0)) Then Exit Function
	ts = CDbl(p(0))
	If Abs(LineNowSec() - ts) > LINE_TOKEN_SEC Then Exit Function
	If LCase(p(1)) = LineHmac(purpose & ":" & p(0)) And LineHmac(purpose & ":" & p(0)) <> "" Then LineCheckToken = True
End Function

'機器人送來的文字：「x」＋每個字的 UTF-16 碼 4 位 hex（避開 Big5／UTF-8 編碼問題）；其他照原樣
'Big5 沒有的字，機器人會先轉成 &#NNNNN;（同網站下單）
Function LineDec(v)
	Dim s, i, out, re
	s = Trim(v & "")
	LineDec = s
	If Left(s, 1) <> "x" Then Exit Function
	s = Mid(s, 2)
	Set re = New RegExp
	re.Pattern = "^([0-9a-fA-F]{4})*$"
	If Not re.Test(s) Then
		LineDec = ""
		Exit Function
	End If
	out = ""
	For i = 1 To Len(s) Step 4
		out = out & ChrW(CLng("&H" & Mid(s, i, 4)))
	Next
	LineDec = Trim(out)
End Function

'JSON 字串，非 ASCII 字元一律 \uXXXX（回應只有 ASCII，不受網頁編碼影響）
Function LineJs(v)
	Dim s, i, c, out
	s = JsonStr(v)
	out = ""
	For i = 1 To Len(s)
		c = AscW(Mid(s, i, 1))
		If c < 0 Then c = c + 65536
		If c > 126 Or c < 32 Then
			out = out & "\u" & Right("000" & Hex(c), 4)
		Else
			out = out & Mid(s, i, 1)
		End If
	Next
	LineJs = out
End Function

'日期時間 → "yyyy-mm-dd hh:nn"（Null 回傳 null）
Function LineDt(d)
	If IsNull(d) Or IsEmpty(d) Then
		LineDt = "null"
	ElseIf Not IsDate(d) Then
		LineDt = "null"
	Else
		LineDt = """" & Year(d) & "-" & Right("0" & Month(d), 2) & "-" & Right("0" & Day(d), 2) & " " & Right("0" & Hour(d), 2) & ":" & Right("0" & Minute(d), 2) & """"
	End If
End Function

Function LineNum(v)
	If IsNull(v) Or IsEmpty(v) Then
		LineNum = "null"
	ElseIf IsNumeric(v) Then
		LineNum = CStr(CDbl(v))
	Else
		LineNum = "null"
	End If
End Function

'只留數字
Function LineDigits(v)
	Dim re
	Set re = New RegExp
	re.Pattern = "\D"
	re.Global = True
	LineDigits = re.Replace(v & "", "")
End Function

'Line_Order 資料表：不存在時建立；成功回傳 True
Function LineEnsure(conn)
	Dim rs
	LineEnsure = True
	On Error Resume Next
	Set rs = conn.Execute("SELECT TOP 1 id FROM Line_Order")
	If Err.Number = 0 Then
		rs.Close
		On Error GoTo 0
		Exit Function
	End If
	Err.Clear
	conn.Execute "CREATE TABLE Line_Order (id COUNTER CONSTRAINT pk_line_order PRIMARY KEY, ref TEXT(40), orderid LONG, line_uid TEXT(64), line_name TEXT(100), created DATETIME, notified DATETIME, notify_count LONG, notify_obts TEXT(255))"
	If Err.Number <> 0 Then
		Err.Clear
		LineEnsure = False
	Else
		conn.Execute "CREATE INDEX ix_line_order_oid ON Line_Order (orderid)"
		conn.Execute "CREATE UNIQUE INDEX ix_line_order_ref ON Line_Order (ref)"
		Err.Clear
	End If
	On Error GoTo 0
End Function

'訂單的 LINE 對應：Array(line_uid, line_name, notified, notify_count)；沒有回傳 Empty
Function LineOrderLink(conn, oid)
	Dim rs
	LineOrderLink = Empty
	If Not LineEnsure(conn) Then Exit Function
	Set rs = conn.Execute("SELECT TOP 1 line_uid, line_name, notified, notify_count FROM Line_Order WHERE orderid = " & CLng(oid) & " ORDER BY id DESC")
	If Not rs.EOF Then LineOrderLink = Array(rs("line_uid") & "", rs("line_name") & "", rs("notified").Value, rs("notify_count").Value)
	rs.Close
End Function

'vieworder_suda.asp：「LINE 通知客人寄出」區塊（已印單時顯示在黑貓宅配單區塊內）
Sub LineNotifyBox(oid)
	Dim conn, lk
	Set conn = SudaDbOpen()
	lk = LineOrderLink(conn, oid)
	conn.Close
	Response.Write "<div style=""margin-top:12px; padding:8px 10px; border:1px solid #9BD3A6; border-radius:6px; background-color:#F1FBF3; line-height:22px"">"
	Response.Write "<b style=""color:#06C755"">LINE 通知客人寄出</b>　"
	If IsArray(lk) Then
		Response.Write "LINE 客人：" & SudaHtml(lk(1))
		If Not IsNull(lk(2)) Then
			Response.Write "　<span style=""color:#666666"">上次通知 " & lk(2) & "（共 " & lk(3) & " 次）</span>"
		Else
			Response.Write "　<span style=""color:#999999"">尚未通知</span>"
		End If
		Response.Write "<br><button type=""button"" id=""line-notify-btn"" style=""padding:4px 12px; margin-top:4px; cursor:pointer"" onclick=""lineNotify(" & CLng(oid) & ")"">傳 LINE 通知：已寄出＋託運單號＋託運單照片</button>"
		Response.Write " <span id=""line-notify-msg"" style=""font-size:9pt""></span>"
		Response.Write "<div style=""color:#999999; font-size:9pt"">會傳給客人：訂單已寄出、託運單號、託運單照片（已產生照片的才會附上）、黑貓查詢網址</div>"
		Response.Write "<script type=""text/javascript"">" & vbCrLf
		Response.Write "function lineNotify(id) {" & vbCrLf
		Response.Write "  if (!window.fetch) { alert('瀏覽器太舊，無法傳送'); return; }" & vbCrLf
		Response.Write "  if (!confirm('確定要用 LINE 通知客人這筆訂單已寄出嗎？')) return;" & vbCrLf
		Response.Write "  var b = document.getElementById('line-notify-btn'), m = document.getElementById('line-notify-msg');" & vbCrLf
		Response.Write "  b.disabled = true; m.style.color = '#999999'; m.innerHTML = '傳送中…';" & vbCrLf
		Response.Write "  var fail = function (t) { b.disabled = false; m.style.color = '#D00000'; m.innerHTML = String(t).replace(/</g, '&lt;'); };" & vbCrLf
		Response.Write "  fetch('line_token.asp?PROID=' + id + '&t=' + new Date().getTime(), { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (tok) {" & vbCrLf
		Response.Write "    tok = tok.replace(/\s/g, '');" & vbCrLf
		Response.Write "    if (!/^[0-9]+\.[0-9a-f]+$/.test(tok)) throw new Error('無法產生通行證');" & vbCrLf
		Response.Write "    return fetch(" & LineJs(LINE_BOT_SITE & "/api/notify/shipped") & ", { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-line-token': tok }, body: JSON.stringify({ sys: " & LineJs(LINE_SYS) & ", orderId: id }) });" & vbCrLf
		Response.Write "  }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (x) {" & vbCrLf
		Response.Write "    if (!x.ok || !x.j.ok) { fail('傳送失敗：' + (x.j && x.j.error || '')); return; }" & vbCrLf
		Response.Write "    b.disabled = false; m.style.color = '#06A04A'; m.innerHTML = '已傳送（' + x.j.waybills + ' 張託運單，' + x.j.images + ' 張照片）';" & vbCrLf
		Response.Write "  })['catch'](function (e) { fail('傳送失敗：' + (e.message || e)); });" & vbCrLf
		Response.Write "}" & vbCrLf
		Response.Write "</script>"
	Else
		Response.Write "<span style=""color:#999999"">這筆訂單不是從 LINE 機器人下單，沒有對應的 LINE 客人，無法用 LINE 通知</span>"
	End If
	Response.Write "</div>"
End Sub
%>
