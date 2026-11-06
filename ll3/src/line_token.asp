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
Dim tkId
tkId = SudaOrderNo(Request.QueryString("PROID"))
If tkId = 0 Then
	Response.Write "id"
Else
	Response.Write LineToken("notify:" & LINE_SYS & ":" & tkId)
End If
%>
