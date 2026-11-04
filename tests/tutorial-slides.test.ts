// tests/tutorial-slides.test.ts — Comprehensive Test Suite for Interactive Tutorial Slides Deck.
//
// Verifies:
//   1. 6 structured tutorial slides (Steps 1 to 6) covering Chapter 3 intelligence gathering.
//   2. Bidirectional Red Team (Attacker) and Blue Team (Defender) perspectives and commands.
//   3. Tutorial slide modal rendering, tabs, dots, and prev/next navigation controls.
//   4. Placement of the '튜토리얼 슬라이드' button immediately to the right of '2x2 관제 (Observer)'.
//   5. Strict design standards compliance (symmetrical borders, button centering, Flaticon UIcons).

import test, { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TUTORIAL_SLIDES,
  renderTutorialSlideModalHtml,
  type TutorialSlide,
} from "../client/src/components/TutorialSlides.ts";
import { renderAppHtml } from "../client/src/App.ts";

describe("Tutorial Interactive Slide Deck Suite", () => {
  it("defines exactly 6 Chapter 3 tutorial slides with complete Red and Blue team metadata", () => {
    assert.equal(TUTORIAL_SLIDES.length, 6, "Must define exactly 6 steps");

    const expectedCategories = [
      "수동 정보 수집",
      "DNS 정보 수집",
      "능동 포트 스캔",
      "타깃 인증 스캔",
      "클라우드 스토리지",
      "커스텀 스캐너 개발",
    ];

    TUTORIAL_SLIDES.forEach((slide, idx) => {
      assert.equal(slide.step, idx + 1);
      assert.equal(slide.category, expectedCategories[idx]);
      assert.ok(slide.title.length > 5);
      assert.ok(slide.subtitle.length > 5);
      assert.ok(slide.badge.length > 2);
      assert.ok(slide.overview.length > 20);
      assert.ok(slide.vulnPrinciple.length > 20);

      // Red Team metadata
      assert.ok(slide.redTeam.title.includes("Red Team") || slide.redTeam.title.includes("공격자"));
      assert.ok(slide.redTeam.techniques.length >= 2);
      assert.ok(slide.redTeam.commands.length >= 1);
      assert.ok(slide.redTeam.obtainedIntel.length >= 5);

      // Blue Team metadata
      assert.ok(slide.blueTeam.title.includes("Blue Team") || slide.blueTeam.title.includes("방어자"));
      assert.ok(slide.blueTeam.detection.length >= 10);
      assert.ok(slide.blueTeam.mitigation.length >= 2);
    });
  });

  it("renders tutorial slide modal HTML with bidirectional navigation controls and tabs", () => {
    // 1. Initial Step 1 (closed)
    const closedHtml = renderTutorialSlideModalHtml(1, false);
    assert.ok(closedHtml.includes('id="tutorial-slides-modal"'));
    assert.ok(closedHtml.includes("hidden"), "Modal should have hidden class when isOpen is false");
    assert.ok(closedHtml.includes("1단계: 수동 정보 수집 — Whois 분석"));
    assert.ok(closedHtml.includes("disabled"), "Prev button should be disabled on first slide");

    // 2. Open on Step 2
    const step2Html = renderTutorialSlideModalHtml(2, true);
    assert.ok(step2Html.includes("flex"), "Modal should have flex class when isOpen is true");
    assert.ok(!step2Html.includes('class="tutorial-slides-modal fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm transition-opacity hidden"'));
    assert.ok(step2Html.includes("2단계: DNS Zone Transfer(AXFR) 영역 전송"));
    assert.ok(step2Html.includes("dig axfr @172.28.0.15 megacorp.internal"));
    assert.ok(step2Html.includes("named.conf"));

    // Check step tabs (1..6)
    for (let i = 1; i <= 6; i++) {
      assert.ok(step2Html.includes(`data-step="${i}"`));
    }

    // Check dot indicators
    assert.ok(step2Html.includes("slide-dot-btn"));

    // 3. Last Step 6
    const step6Html = renderTutorialSlideModalHtml(6, true);
    assert.ok(step6Html.includes("6단계: 커스텀 MSF 스캐너 루비 모듈 작성"));
    assert.ok(step6Html.includes("custom_tcp_banner.rb"));
    assert.ok(step6Html.includes("disabled"), "Next button should be disabled on last slide");
  });

  it("renders '튜토리얼 슬라이드' button immediately to the right of '2x2 관제 (Observer)' in App header", () => {
    const html = renderAppHtml({ role: "observer" });

    // Verify presence of both buttons
    assert.ok(html.includes("2x2 관제 (Observer)"));
    assert.ok(html.includes("btn-tutorial-slides"));
    assert.ok(html.includes("튜토리얼 슬라이드"));
    assert.ok(html.includes("fi fi-rr-presentation"));

    // Verify ordering: 2x2 관제 precedes 튜토리얼 슬라이드
    const observerIdx = html.indexOf("2x2 관제 (Observer)");
    const slidesBtnIdx = html.indexOf("btn-tutorial-slides");
    assert.ok(observerIdx !== -1, "2x2 관제 button must exist");
    assert.ok(slidesBtnIdx !== -1, "튜토리얼 슬라이드 button must exist");
    assert.ok(
      slidesBtnIdx > observerIdx,
      "튜토리얼 슬라이드 button must be placed after 2x2 관제 (Observer)"
    );

    // Verify they are within the same navigation container
    const navStart = html.indexOf("<nav");
    const navEnd = html.indexOf("</nav>");
    assert.ok(observerIdx > navStart && observerIdx < navEnd);
    assert.ok(slidesBtnIdx > navStart && slidesBtnIdx < navEnd);
  });

  it("complies strictly with project design standards", () => {
    const modalHtml = renderTutorialSlideModalHtml(3, true);

    // 1. Anti-Fingernail: No border-l-4 or border-l-2 with rounded-*
    assert.ok(!modalHtml.includes("border-l-4"), "Must NOT use border-l-4 fingernail design");
    assert.ok(!modalHtml.includes("border-l-2"), "Must NOT use border-l-2 fingernail design");

    // 2. Button & Chip Perfect Centering
    assert.ok(modalHtml.includes("inline-flex items-center justify-center leading-none"));

    // 3. Flaticon UIcons regular rounded only
    assert.ok(modalHtml.includes("fi fi-rr-"));
    assert.ok(!modalHtml.includes("lucide-"), "Must NOT use Lucide icons");
    assert.ok(!modalHtml.includes("<svg"), "Must NOT use arbitrary raw inline SVG");

    // 4. Korean Typography
    assert.ok(modalHtml.includes("break-keep"));
  });
});
