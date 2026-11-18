<%
IF SESSION("ADMIN")="" THEN
	Response.Write "login"
	Response.End
END IF
Response.Expires = 0
Response.CacheControl = "no-cache"
%>
<!-- #include file="suda_config.asp" -->
<!-- #include file="line_config.asp" -->
<%
'vieworder_suda.asp「LINE 通知客人寄出」：管理者登入後取得這筆訂單的通知通行證（300 秒內有效）
'?info=1：回傳「上次通知」那一段 HTML（傳送成功後更新畫面用）
Dim tkId, tkConn, tkLk
tkId = SudaOrderNo(Request.QueryString("PROID"))
If tkId = 0 Then
	Response.Write "id"
ElseIf Request.QueryString("info") = "1" Then
	Set tkConn = SudaDbOpen()
	tkLk = LineOrderLink(tkConn, tkId)
	tkConn.Close
	If IsArray(tkLk) Then Response.Write LineAsciiHtml(LineLastHtml(tkLk))
Else
	Response.Write LineToken("notify:" & LINE_SYS & ":" & tkId)
End If
%>
