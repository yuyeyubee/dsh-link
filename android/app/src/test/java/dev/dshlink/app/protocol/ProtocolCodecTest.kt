package dev.dshlink.app.protocol

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolCodecTest {

    private val token = "0123456789abcdef".repeat(4)

    @Test
    fun parsesWelcome() {
        val frame = Frames.parse(
            """
            {"t":"welcome","v":1,
             "self":{"id":"dev_abc","name":"家里的 MacBook","platform":"macos"},
             "peers":[{"id":"dev_yyy","name":"出差笔记本","platform":"windows","since":1762531200000}]}
            """.trimIndent(),
        )
        assertTrue(frame is RelayFrame.Welcome)
        val welcome = frame as RelayFrame.Welcome
        assertEquals("dev_abc", welcome.self?.id)
        assertEquals("macOS", welcome.self?.platformLabel)
        assertEquals(1, welcome.peers.size)
        assertEquals("出差笔记本", welcome.peers[0].name)
        assertEquals(1762531200000L, welcome.peers[0].since)
    }

    @Test
    fun parsesPresence() {
        val frame = Frames.parse("""{"t":"presence","peers":[{"id":"dev_a","name":"A","platform":"linux"}]}""")
        assertTrue(frame is RelayFrame.Presence)
        assertEquals("dev_a", (frame as RelayFrame.Presence).peers.single().id)
    }

    @Test
    fun parsesReplyOkAndError() {
        val ok = Frames.parse("""{"t":"reply","id":"c1","ok":true,"result":{"sessionId":"session-1"}}""")
        assertTrue(ok is RelayFrame.Reply)
        assertEquals("session-1", (ok as RelayFrame.Reply).result?.optString("sessionId"))

        val bad = Frames.parse(
            """{"t":"reply","id":"c2","ok":false,"error":{"code":"offline","message":"目标离线"}}""",
        )
        assertTrue(bad is RelayFrame.Reply)
        bad as RelayFrame.Reply
        assertFalse(bad.ok)
        assertEquals("offline", bad.error?.code)
        assertEquals("目标离线", bad.error?.message)
    }

    @Test
    fun parsesEventAndEnd() {
        val event = Frames.parse("""{"t":"event","id":"s1","data":{"t":"record","record":{"kind":"user","seq":3,"text":"hi"}}}""")
        assertTrue(event is RelayFrame.Event)
        assertEquals("s1", (event as RelayFrame.Event).id)

        val end = Frames.parse("""{"t":"end","id":"s1"}""")
        assertTrue(end is RelayFrame.Ended)
        assertEquals("s1", (end as RelayFrame.Ended).id)
    }

    @Test
    fun parsesRelayErrorAndGarbage() {
        val error = Frames.parse("""{"t":"error","code":"auth-failed","message":"bad token"}""")
        assertTrue(error is RelayFrame.ServerError)
        assertEquals("auth-failed", (error as RelayFrame.ServerError).code)
        assertNull(Frames.parse("not json"))
        assertNull(Frames.parse(""))
        assertTrue(Frames.parse("""{"t":"whatever"}""") is RelayFrame.Unknown)
    }

    @Test
    fun encodesHelloFrame() {
        val json = JSONObject(Frames.hello(token, "dev_1234567890abcdef", "Mate X7"))
        assertEquals("hello", json.getString("t"))
        assertEquals(1, json.getInt("v"))
        assertEquals("client", json.getString("role"))
        assertEquals(token, json.getString("token"))
        val device = json.getJSONObject("device")
        assertEquals("dev_1234567890abcdef", device.getString("id"))
        assertEquals("Mate X7", device.getString("name"))
        assertEquals("android", device.getString("platform"))
    }

    @Test
    fun encodesCallSubUnsub() {
        val call = JSONObject(Frames.call("c9", "dev_yyy", "session.list", JSONObject()))
        assertEquals("call", call.getString("t"))
        assertEquals("c9", call.getString("id"))
        assertEquals("dev_yyy", call.getString("to"))
        assertEquals("session.list", call.getString("method"))

        val sub = JSONObject(
            Frames.sub("s1", "dev_yyy", "session.follow", JSONObject().put("sessionId", "session-1")),
        )
        assertEquals("sub", sub.getString("t"))
        assertEquals("session-1", sub.getJSONObject("params").getString("sessionId"))

        val unsub = JSONObject(Frames.unsub("s1"))
        assertEquals("unsub", unsub.getString("t"))
        assertEquals("s1", unsub.getString("id"))
    }

    @Test
    fun parsesAllChatRecordKinds() {
        val user = ChatRecord.parse(JSONObject("""{"kind":"user","seq":12,"time":1762531200000,"text":"帮我看看构建"}"""))
        assertTrue(user is ChatRecord.User)
        assertEquals(12L, user!!.seq)

        val assistant = ChatRecord.parse(
            JSONObject("""{"kind":"assistant","seq":15,"time":1762531201000,"text":"好的","reasoning":"先看日志"}"""),
        )
        assertTrue(assistant is ChatRecord.Assistant)
        assertEquals("先看日志", (assistant as ChatRecord.Assistant).reasoning)

        val call = ChatRecord.parse(
            JSONObject("""{"kind":"tool-call","seq":16,"callId":"call_1","name":"bash","args":"{\"command\":\"ls\"}"}"""),
        )
        assertTrue(call is ChatRecord.ToolCall)
        assertEquals("bash", (call as ChatRecord.ToolCall).name)

        val result = ChatRecord.parse(
            JSONObject("""{"kind":"tool-result","seq":17,"callId":"call_1","name":"bash","isError":false,"text":"a.txt"}"""),
        )
        assertTrue(result is ChatRecord.ToolResult)
        assertFalse((result as ChatRecord.ToolResult).isError)

        val turnStart = ChatRecord.parse(JSONObject("""{"kind":"turn-start","seq":10,"turn":1}"""))
        assertTrue(turnStart is ChatRecord.TurnStart)
        assertEquals(1, (turnStart as ChatRecord.TurnStart).turn)

        val turnEnd = ChatRecord.parse(
            JSONObject("""{"kind":"turn-end","seq":20,"turn":1,"reason":"completed"}"""),
        )
        assertTrue(turnEnd is ChatRecord.TurnEnd)
        assertEquals("completed", (turnEnd as ChatRecord.TurnEnd).reason)

        val error = ChatRecord.parse(JSONObject("""{"kind":"error","seq":21,"message":"模型失败"}"""))
        assertTrue(error is ChatRecord.ErrorEntry)
        assertEquals("模型失败", (error as ChatRecord.ErrorEntry).message)
    }

    @Test
    fun ignoresUnknownOrBrokenRecords() {
        assertNull(ChatRecord.parse(JSONObject("""{"kind":"mystery","seq":1}""")))
        assertNull(ChatRecord.parse(JSONObject("""{"kind":"user","text":"no seq"}""")))
        assertTrue(ChatRecord.parseList(null).isEmpty())
    }

    @Test
    fun parsesSessionSummaryAndState() {
        val summary = SessionSummary.parse(
            JSONObject(
                """
                {"sessionId":"session-1","title":"重构登录页","cwd":"/Users/me/project",
                 "updatedAt":1762531200000,"running":true,"active":true,
                 "agentAvailable":true,"blank":false,"parentSessionId":null}
                """.trimIndent(),
            ),
        )
        assertEquals("重构登录页", summary?.title)
        assertTrue(summary?.running == true)
        assertEquals("/Users/me/project", summary?.cwd)

        val minimal = SessionSummary.parse(JSONObject("""{"sessionId":"s2","title":""}"""))
        assertEquals("", minimal?.title)
        assertNull(minimal?.cwd)
        assertNull(minimal?.parentSessionId)

        val state = SessionState.parse(
            JSONObject("""{"active":false,"running":true,"queueCount":2,"pendingInput":["approval"]}"""),
        )
        assertTrue(state.running)
        assertEquals(2, state.queueCount)
        assertEquals(listOf("approval"), state.pendingInput)
    }

    @Test
    fun parsesFollowSnapshot() {
        val data = FollowData.parse(
            JSONObject(
                """
                {"t":"snapshot","records":[
                   {"kind":"user","seq":1,"text":"hi"},
                   {"kind":"assistant","seq":2,"text":"hello"}
                 ],"cursor":2,"state":{"running":false,"queueCount":0}}
                """.trimIndent(),
            ),
        )
        assertTrue(data is FollowData.Snapshot)
        data as FollowData.Snapshot
        assertEquals(2, data.records.size)
        assertEquals(2L, data.cursor)
        assertEquals("hello", (data.records[1] as ChatRecord.Assistant).text)
    }

    @Test
    fun parsesFollowReadyRecordStateTitleError() {
        assertTrue(
            FollowData.parse(JSONObject("""{"t":"ready","sessionId":"s","title":"标题"}""")) is FollowData.Ready,
        )
        assertTrue(
            FollowData.parse(
                JSONObject("""{"t":"record","record":{"kind":"error","seq":5,"message":"x"}}"""),
            ) is FollowData.Record,
        )
        val state = FollowData.parse(JSONObject("""{"t":"state","state":{"running":true}}"""))
        assertTrue(state is FollowData.StateChanged)
        assertTrue((state as FollowData.StateChanged).state.running)

        assertTrue(FollowData.parse(JSONObject("""{"t":"title","title":"新标题"}""")) is FollowData.Title)
        val failure = FollowData.parse(JSONObject("""{"t":"error","code":"not-found","message":"没了"}"""))
        assertTrue(failure is FollowData.Failure)
        assertEquals("not-found", (failure as FollowData.Failure).code)
        assertTrue(FollowData.parse(JSONObject("""{"t":"nope"}""")) is FollowData.Unknown)
    }

    @Test
    fun parsesDeviceInfo() {
        val info = DeviceInfo.parse(
            JSONObject(
                """
                {"deviceId":"dev_1","name":"Mac","platform":"macos","version":"1.0.0",
                 "dshVersion":"0.2.2-rc.1","time":1762531200000,"workspaceDefault":"/tmp",
                 "capabilities":["sessions","speech"],
                 "speech":{"available":true,"providers":[{"id":"sensevoice-local","name":"SenseVoice"}],"language":"zh"}}
                """.trimIndent(),
            ),
        )
        assertTrue(info.speechAvailable == true)
        assertEquals("sensevoice-local", info.speechProviders.single())
        assertEquals("zh", info.speechLanguage)
        assertEquals(listOf("sessions", "speech"), info.capabilities)

        val noSpeech = DeviceInfo.parse(JSONObject("""{"deviceId":"dev_2"}"""))
        assertNull(noSpeech.speechAvailable)
    }

    @Test
    fun parsesWorkspaceList() {
        val items = WorkspaceInfo.parseList(
            org.json.JSONArray("""[{"workspaceId":"w1","title":"项目","path":"/tmp/p"}]"""),
        )
        assertEquals(1, items.size)
        assertEquals("w1", items[0].workspaceId)
        assertEquals("/tmp/p", items[0].path)
    }
}
