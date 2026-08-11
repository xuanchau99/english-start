"""Visible-browser end-to-end smoke test for FluentGo.

Run from the project root with: python browser-e2e.py
The script creates one isolated E2E account in the configured Apps Script backend.
"""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import time
import traceback
import urllib.request
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parent
CHROME = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
ARTIFACTS = ROOT / "test-artifacts"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


class Report:
    def __init__(self) -> None:
        self.rows: list[dict[str, str]] = []
        self.target_filter = {item.strip().lower() for item in os.environ.get("FLUENTGO_E2E_TARGETS", "").split(",") if item.strip()}

    def run(self, name, callback):
        if self.target_filter and not name.startswith("Authentication") and not any(target in name.lower() for target in self.target_filter):
            return None
        started = time.time()
        try:
            detail = callback() or "OK"
            self.rows.append({"name": name, "status": "PASS", "detail": str(detail), "seconds": f"{time.time()-started:.1f}"})
            print(f"PASS | {name} | {detail}", flush=True)
            return True
        except Exception as error:  # keep testing independent areas
            detail = f"{type(error).__name__}: {error}"
            trace = traceback.extract_tb(error.__traceback__)
            if trace:
                detail += f" @ {Path(trace[-1].filename).name}:{trace[-1].lineno}"
            self.rows.append({"name": name, "status": "FAIL", "detail": detail, "seconds": f"{time.time()-started:.1f}"})
            print(f"FAIL | {name} | {detail}", flush=True)
            return False


def reserve_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def wait_server(base_url, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(base_url, timeout=1) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(0.25)
    raise RuntimeError("Local server did not start")


def visible(locator):
    return locator.count() > 0 and locator.first.is_visible()


def wait_ai(page, selector, timeout=70000):
    page.wait_for_function(
        """selector => {
          const target=document.querySelector(selector);
          const toast=[...document.querySelectorAll('.toast')].some(item=>item.offsetParent!==null);
          return !!(target && target.classList.contains('show')) || toast;
        }""",
        arg=selector,
        timeout=timeout,
    )


def answer_choice(page, list_selector, next_selector):
    options = page.locator(f"{list_selector} button")
    expect(options.first).to_be_visible()
    options.first.click()
    expect(page.locator(next_selector)).to_be_visible()


def main():
    ARTIFACTS.mkdir(exist_ok=True)
    report = Report()
    port = reserve_free_port()
    base_url = f"http://127.0.0.1:{port}"
    server_env = os.environ.copy()
    server_env["PORT"] = str(port)
    server = subprocess.Popen(
        ["node", "server.js"], cwd=ROOT, env=server_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    browser = None
    context = None
    page = None
    console_errors: list[str] = []
    page_errors: list[str] = []
    stamp = str(int(time.time()))[-9:]
    username = os.environ.get("FLUENTGO_E2E_USERNAME", f"e2e{stamp}")
    email = f"{username}@example.com"
    login_identifier = os.environ.get("FLUENTGO_E2E_IDENTIFIER", username)
    password = "FluentGo!2026"

    try:
        wait_server(base_url)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                executable_path=CHROME,
                headless=False,
                slow_mo=35,
                args=[
                    "--use-fake-ui-for-media-stream",
                    "--use-fake-device-for-media-stream",
                    "--autoplay-policy=no-user-gesture-required",
                    "--disable-background-timer-throttling",
                ],
            )
            context = browser.new_context(
                viewport={"width": 1440, "height": 920},
                permissions=["microphone"],
                locale="vi-VN",
            )
            page = context.new_page()
            page.set_default_timeout(15000)
            page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            page.on("dialog", lambda dialog: dialog.accept())

            def load_and_register():
                page.goto(base_url, wait_until="domcontentloaded", timeout=30000)
                expect(page.locator("#authSystemState")).to_have_class(re.compile(r"ready"), timeout=45000)
                page.screenshot(path=str(ARTIFACTS / "01-auth-ready.png"), full_page=True)
                if os.environ.get("FLUENTGO_E2E_USERNAME"):
                    for attempt in range(2):
                        page.locator("#loginIdentifier").fill(login_identifier)
                        page.locator("#loginPassword").fill(password)
                        page.locator("#loginForm .auth-submit").click()
                        try:
                            expect(page.locator("#authGate")).to_have_class(re.compile(r"hidden"), timeout=105000)
                            break
                        except AssertionError:
                            if attempt:
                                raise
                            page.reload(wait_until="domcontentloaded")
                            expect(page.locator("#authSystemState")).to_have_class(re.compile(r"ready"), timeout=45000)
                    return f"logged in as existing test user {username}"
                page.locator('[data-auth-tab="register"]').first.click()
                page.locator("#registerName").fill("FluentGo E2E")
                page.locator("#registerUsername").fill(username)
                page.locator("#registerEmail").fill(email)
                page.locator("#registerPassword").fill(password)
                page.locator("#acceptTerms").check()
                page.locator("#registerForm .auth-submit").click()
                expect(page.locator("#authGate")).to_have_class(re.compile(r"hidden"), timeout=70000)
                expect(page.locator("#view-home")).to_have_class(re.compile(r"active"))
                return f"registered {username} through Apps Script"

            authenticated = report.run("Authentication: register", load_and_register)
            if not authenticated:
                raise RuntimeError("Authentication is required for the remaining browser tests")

            def home_navigation():
                expect(page.locator("#view-home")).to_be_visible()
                page.locator("#notificationBtn").click()
                expect(page.locator(".toast").last).to_be_visible()
                if visible(page.locator(".dismiss-btn")):
                    page.locator(".dismiss-btn").click()
                page.screenshot(path=str(ARTIFACTS / "02-home.png"), full_page=True)
                return "home, notification and reminder controls"

            report.run("Home dashboard", home_navigation)

            def settings_global():
                page.locator('.sidebar [data-route="profile"]').click()
                expect(page.locator("#view-profile")).to_have_class(re.compile(r"active"))
                page.locator(".open-settings").first.click()
                expect(page.locator("#settingsModal")).to_have_class(re.compile(r"open"))
                page.locator("#settingName").fill("FluentGo Browser Test")
                page.locator("#settingLevel").select_option(label="A1 · Người mới bắt đầu")
                page.locator("#settingLearningGoal").select_option("developer")
                page.locator("#settingSpeechRate").select_option("0.9")
                page.locator("#previewVoice").click()
                page.locator("#saveSettings").click()
                expect(page.locator("#settingsModal")).not_to_have_class(re.compile(r"open"), timeout=30000)
                expect(page.locator("#profileLearningGoal")).to_contain_text("lập trình")
                return "goal, level, voice rate, preview and profile save"

            report.run("Global learner settings", settings_global)

            def roadmap_lesson():
                page.locator('.sidebar [data-route="learn"]').click()
                expect(page.locator("#view-learn")).to_have_class(re.compile(r"active"))
                expect(page.locator(".roadmap-route")).to_be_visible()
                assert page.locator(".map-node").count() == 6
                page.locator("#roadmapUnitSelect").select_option("1")
                expect(page.locator("#roadmapTitle")).not_to_be_empty()
                page.locator("#previousRoadmapUnit").click()
                node = page.locator(".map-node.current, .map-node.available").first
                node.click()
                expect(page.locator("#lessonModal")).to_have_class(re.compile(r"open"))
                for _ in range(12):
                    if visible(page.locator(".lesson-finish")):
                        page.locator(".lesson-finish").click()
                        break
                    if visible(page.locator(".lesson-audio")):
                        page.locator(".lesson-audio").click()
                    if visible(page.locator(".lesson-options button")):
                        page.locator(".lesson-options button").first.click()
                        page.locator(".lesson-check").click()
                        page.locator(".lesson-next").click()
                    elif visible(page.locator(".lesson-next")):
                        page.locator(".lesson-next").click()
                    else:
                        raise AssertionError("Lesson has no actionable control")
                expect(page.locator("#lessonModal")).not_to_have_class(re.compile(r"open"))
                page.screenshot(path=str(ARTIFACTS / "03-roadmap.png"), full_page=True)
                return "winding map, unit navigation and complete lesson flow"

            report.run("Roadmap and lesson", roadmap_lesson)

            def open_practice(skill):
                page.locator('.sidebar [data-route="practice"]').click()
                page.locator(f'.practice-tab[data-practice="{skill}"]').click()
                expect(page.locator(f"#practice-{skill}")).to_have_class(re.compile(r"active"))

            def listening_sessions():
                open_practice("listening")
                signatures = []
                for index in range(8):
                    if index == 0:
                        page.locator("#playListening").click()
                        page.wait_for_timeout(300)
                    answer_choice(page, "#listeningAnswers", "#nextListening")
                    signatures.append(page.locator("#listeningQuestion").inner_text()+"|"+page.locator("#listeningTranscript").inner_text())
                    page.locator("#nextListening").click()
                expect(page.locator("#listeningSummary")).to_be_visible()
                page.locator('#listeningSummary .session-restart[data-type="listening"]').click()
                answer_choice(page, "#listeningAnswers", "#nextListening")
                fresh = page.locator("#listeningQuestion").inner_text()+"|"+page.locator("#listeningTranscript").inner_text()
                assert fresh and fresh not in signatures
                return "8-question session, English transcript and unseen next session"

            report.run("Listening and non-repeat", listening_sessions)

            def reading_sessions():
                open_practice("reading")
                signatures = []
                for index in range(8):
                    signatures.append(page.locator("#readingQuestion").inner_text()+"|"+page.locator("#readingPassage").inner_text())
                    if index == 0:
                        page.locator("#readPassage").click()
                    answer_choice(page, "#readingAnswers", "#nextReading")
                    page.locator("#nextReading").click()
                expect(page.locator("#readingSummary")).to_be_visible()
                page.locator('#readingSummary .session-restart[data-type="reading"]').click()
                fresh = page.locator("#readingQuestion").inner_text()+"|"+page.locator("#readingPassage").inner_text()
                assert fresh and fresh not in signatures
                return "8-question session, read-aloud and unseen next passage"

            report.run("Reading and non-repeat", reading_sessions)

            def flashcard_and_quiz():
                open_practice("vocabulary")
                first_set = []
                for _ in range(12):
                    page.wait_for_timeout(260)
                    first_set.append(page.locator("#flashWord").inner_text())
                    page.locator("#flashcard").click()
                    page.locator('.flash-actions button[data-memory="easy"]').click()
                expect(page.locator("#vocabularySummary")).to_be_visible()
                page.locator("#vocabularySummary .start-vocabulary-quiz").click()
                for _ in range(12):
                    if not visible(page.locator(".vocabulary-quiz-options button")):
                        break
                    page.locator(".vocabulary-quiz-options button").first.click()
                    page.locator(".vocabulary-quiz-next").click()
                expect(page.locator(".retry-vocabulary-quiz")).to_be_visible()
                page.locator('#vocabularySummary .session-restart[data-type="vocabulary"]').click()
                page.wait_for_timeout(300)
                fresh = page.locator("#flashWord").inner_text()
                assert len(set(first_set)) == 12 and fresh not in first_set
                return "12 unique cards, 4-option quiz, score and fresh second deck"

            report.run("Flashcard and scored quiz", flashcard_and_quiz)

            def challenge_nonrepeat():
                open_practice("challenge")
                signatures = []
                for _ in range(20):
                    signatures.append(page.locator("#challengeQuestion").inner_text()+"|"+page.locator("#challengeAnswers").inner_text()+"|"+page.locator("#challengePassage").inner_text())
                    if visible(page.locator("#playChallengeAudio")):
                        page.locator("#playChallengeAudio").click()
                    answer_choice(page, "#challengeAnswers", "#nextChallenge")
                    page.locator("#nextChallenge").click()
                expect(page.locator("#challengeSummary")).to_be_visible()
                page.locator('#challengeSummary .session-restart[data-type="challenge"]').click()
                fresh = page.locator("#challengeQuestion").inner_text()+"|"+page.locator("#challengeAnswers").inner_text()+"|"+page.locator("#challengePassage").inner_text()
                assert fresh and fresh not in signatures
                return "20 mixed exercises and unseen next Practice Lab session"

            report.run("Practice Lab and non-repeat", challenge_nonrepeat)

            def speaking_ai():
                open_practice("speaking")
                page.locator("#playSpeakingSample").click()
                page.locator("#recordBtn").click()
                page.wait_for_timeout(1400)
                page.locator("#recordBtn").click()
                expect(page.locator("#analyzeSpeech")).to_be_visible(timeout=6000)
                page.locator("#analyzeSpeech").click()
                wait_ai(page, "#speechFeedback")
                assert visible(page.locator("#speechFeedback")) or visible(page.locator(".toast"))
                return "sample voice, continuous microphone, stop and Gemini pronunciation request"

            report.run("Speaking with microphone and AI", speaking_ai)

            def writing_ai():
                open_practice("writing")
                text = "I use the development environment every day. I read the documentation, test my code, and ask my team for clear feedback before the next step."
                page.locator("#writingInput").fill(text)
                page.locator("#checkWriting").click()
                wait_ai(page, "#writingFeedback")
                assert visible(page.locator("#writingFeedback")) or visible(page.locator(".toast"))
                return "minimum words, character counter and Gemini writing request"

            report.run("Writing with AI", writing_ai)

            def complete_exam():
                open_practice("exam")
                assert page.locator("#examBadgeGrid .exam-badge").count() == 20
                page.locator("#examBadgeGrid .exam-badge").first.click()
                expect(page.locator("#examPlayer")).to_be_visible()
                assert re.fullmatch(r"\d{2}:\d{2}", page.locator("#examTimer").inner_text())
                for question_index in range(15):
                    expect(page.locator("#examQuestionBody")).to_be_visible()
                    if visible(page.locator(".exam-speaking-card")):
                        page.locator(".exam-sample").click()
                        page.locator(".exam-record-btn").click(force=True)
                        page.wait_for_timeout(1200)
                        page.locator(".exam-record-btn").click(force=True)
                        expect(page.locator("#gradeExamSpeaking")).to_be_visible(timeout=7000)
                        page.locator("#gradeExamSpeaking").click()
                        expect(page.locator("#nextExamQuestion")).to_be_visible(timeout=70000)
                    elif visible(page.locator(".exam-writing-card")):
                        page.locator("#examWritingInput").fill(
                            "I am improving my English for software development. I study one practical topic, explain one reason, give a clear example, and decide the next action with my team."
                        )
                        page.locator("#gradeExamWriting").click()
                        expect(page.locator("#nextExamQuestion")).to_be_visible(timeout=70000)
                    else:
                        if visible(page.locator(".exam-audio-button")):
                            page.locator(".exam-audio-button").click()
                        page.locator(".exam-options button").first.click()
                        expect(page.locator("#nextExamQuestion")).to_be_visible()
                    page.locator("#nextExamQuestion").click()
                expect(page.locator("#examResult")).to_be_visible(timeout=30000)
                expect(page.locator(".exam-final-score")).to_be_visible()
                saved = page.evaluate("() => Object.values(localStorage).some(value => value.includes('examResults'))")
                assert saved
                page.screenshot(path=str(ARTIFACTS / "04-exam-result.png"), full_page=True)
                page.locator(".exam-back-bank").click()
                assert page.locator("#examBadgeGrid .exam-badge.new").count() == 19
                return "20 badges, timer, all 15 question types, scoring and saved result"

            report.run("Timed 15-question exam", complete_exam)

            if not report.target_filter or any(target in "ai-generated practice lab set mochi ai conversation" for target in report.target_filter):
                print("INFO | Cooling down AI per-minute quota for the remaining live AI checks", flush=True)
                page.wait_for_timeout(65000)

            def generated_ai_set():
                open_practice("challenge")
                page.locator("#generateAiChallenge").click()
                page.wait_for_function(
                    """() => document.querySelector('#generateAiChallenge').textContent.includes('AI tạo bộ mới')""",
                    timeout=70000,
                )
                label = page.locator("#challengeLevel").inner_text()
                if "AI PRACTICE SET" not in label:
                    toast = page.locator(".toast").last.inner_text() if page.locator(".toast").count() else "no response"
                    raise AssertionError(toast)
                return "Gemini returned a valid fresh exercise set"

            report.run("AI-generated Practice Lab set", generated_ai_set)

            def chat_ai():
                open_practice("chat")
                page.locator("#scenarioGroups button").first.click()
                page.locator("#startConversation").click()
                expect(page.locator("#chatInput")).to_be_enabled(timeout=105000)
                page.locator("#chatInput").fill("Hello! I would like to introduce myself and ask one question.")
                page.locator("#sendChat").click()
                expect(page.locator(".toggle-chat-review")).to_be_visible(timeout=105000)
                page.locator(".toggle-chat-review").first.click()
                page.locator("#endConversation").click()
                return "scenario, user turn, Gemini reply, review card and end conversation"

            report.run("Mochi AI conversation", chat_ai)

            def review_and_sync():
                page.locator('.sidebar [data-route="review"]').click()
                expect(page.locator("#view-review")).to_have_class(re.compile(r"active"))
                if visible(page.locator(".review-mistake")):
                    page.locator(".review-mistake").first.click()
                page.locator('.sidebar [data-route="profile"]').click()
                page.locator("#syncNow").click()
                expect(page.locator("#syncState")).to_have_text(re.compile(r"Đã đồng bộ|Lỗi đồng bộ"), timeout=30000)
                assert "Đã đồng bộ" in page.locator("#syncState").inner_text()
                return "mistake review and explicit Google Sheets sync"

            report.run("Review and cloud sync", review_and_sync)

            def restore_logout_login():
                page.locator('.sidebar [data-route="profile"]').click()
                page.locator(".open-settings").first.click()
                page.locator("#settingLearningGoal").select_option("developer")
                page.locator("#saveSettings").click()
                expect(page.locator("#settingsModal")).not_to_have_class(re.compile(r"open"), timeout=30000)
                page.locator("#syncNow").click()
                expect(page.locator("#syncState")).to_have_text(re.compile(r"Đã đồng bộ"), timeout=105000)
                page.reload(wait_until="domcontentloaded")
                expect(page.locator("#authGate")).to_have_class(re.compile(r"hidden"), timeout=105000)
                page.locator('.sidebar [data-route="profile"]').click()
                expect(page.locator("#profileLearningGoal")).to_contain_text("lập trình")
                page.locator(".logout-action").first.click()
                expect(page.locator("#authGate")).not_to_have_class(re.compile(r"hidden"), timeout=30000)
                page.locator("#loginIdentifier").fill(login_identifier)
                page.locator("#loginPassword").fill(password)
                page.locator("#loginForm .auth-submit").click()
                expect(page.locator("#authGate")).to_have_class(re.compile(r"hidden"), timeout=105000)
                page.locator('.sidebar [data-route="profile"]').click()
                expect(page.locator("#profileLearningGoal")).to_contain_text("lập trình")
                return "cloud goal persistence, session restore, logout and username login"

            report.run("Session persistence and login", restore_logout_login)

            def responsive_mobile():
                if not page.locator("#authGate").evaluate("element => element.classList.contains('hidden')"):
                    page.locator("#loginIdentifier").fill(login_identifier)
                    page.locator("#loginPassword").fill(password)
                    page.locator("#loginForm .auth-submit").click()
                    expect(page.locator("#authGate")).to_have_class(re.compile(r"hidden"), timeout=105000)
                page.set_viewport_size({"width": 390, "height": 844})
                page.locator('.bottom-nav [data-route="practice"]').click()
                expect(page.locator(".bottom-nav")).to_be_visible()
                expect(page.locator(".practice-menu")).to_be_visible()
                page.screenshot(path=str(ARTIFACTS / "05-mobile-practice.png"), full_page=True)
                page.set_viewport_size({"width": 1440, "height": 920})
                return "390×844 mobile navigation and practice layout"

            report.run("Responsive mobile layout", responsive_mobile)

            def runtime_health():
                relevant_console = [message for message in console_errors if "favicon" not in message.lower()]
                assert not page_errors, page_errors
                assert not relevant_console, relevant_console
                return "no uncaught page errors or console errors"

            report.run("Browser runtime health", runtime_health)

            page.screenshot(path=str(ARTIFACTS / "06-final.png"), full_page=True)
            print("E2E_REPORT=" + json.dumps(report.rows, ensure_ascii=False), flush=True)
            passed = sum(row["status"] == "PASS" for row in report.rows)
            failed = len(report.rows) - passed
            print(f"E2E_SUMMARY={passed} passed, {failed} failed", flush=True)
            try:
                browser.close()
            except Exception:
                pass
            browser = None
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass
        if context:
            context = None
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == "__main__":
    main()
