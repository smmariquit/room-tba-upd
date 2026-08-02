<script lang="ts">
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import { fly } from "svelte/transition";
  import { MediaQuery } from "svelte/reactivity";
  import { trapFocus } from "@lib/focus-trap";
  import { fullScreenReveal } from "@lib/motion";
  import { sidebarStore, termStore } from "@lib/store.svelte";
  import {
    buildYearTimeline,
    currentAcademicYearTerms,
    resolveTermWindow,
    termWindowStatus,
    type TermStatus,
  } from "@lib/academic-calendar";
  import { formatTermDateRange } from "@lib/term-calendar";
  import { termChipLabel, termFullLabel } from "@lib/term-label";

  const reducedMotion = new MediaQuery("(prefers-reduced-motion: reduce)");

  // One snapshot per open keeps the screen calm and static.
  const today = new Date();

  let screenEl = $state<HTMLDivElement | null>(null);

  function close() {
    sidebarStore.changeOpened("map");
  }

  $effect(() => {
    if (!screenEl) return;
    return trapFocus(screenEl, { onEscape: close });
  });

  const activeTerms = $derived(termStore.terms.filter((term) => term.isActive));

  const yearTerms = $derived(currentAcademicYearTerms(activeTerms, today));

  const timeline = $derived(buildYearTimeline(yearTerms, today));

  const timelineHeading = $derived(
    yearTerms[0]?.schoolYear
      ? `AY ${yearTerms[0].schoolYear.replace("-", " - ")}`
      : "Academic year",
  );

  const todayLabel = today.toLocaleDateString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  });

  type CardStatus = TermStatus | "undated";
  const STATUS_LABEL: Record<CardStatus, string> = {
    "in-session": "In session",
    upcoming: "Upcoming",
    past: "Ended",
    undated: "Dates TBA",
  };

  const cards = $derived(
    activeTerms.map((term) => {
      const window = resolveTermWindow(term);
      const status: CardStatus = window
        ? termWindowStatus(window, today)
        : "undated";
      return { term, window, status };
    }),
  );
</script>

<div
  bind:this={screenEl}
  class="acal-screen"
  role="dialog"
  aria-modal="true"
  aria-labelledby="acal-screen-title"
  in:fly={fullScreenReveal(reducedMotion.current)}
>
  <header class="acal-header">
    <button
      type="button"
      class="acal-back"
      onclick={close}
      aria-label="Back to map"
      title="Back to map"
    >
      <ChevronLeft size={18} aria-hidden="true" />
      <span>Back to map</span>
    </button>
    <h1 class="acal-title" id="acal-screen-title">Academic Calendar</h1>
  </header>

  <p class="acal-note" role="note">
    Community-maintained instructional windows per CRS term. Dates may differ
    from the official UP Diliman academic calendar. Verify with the Office of
    the University Registrar.
  </p>

  <div class="acal-body">
    {#if !termStore.loaded}
      <p class="acal-status" role="status">Loading terms…</p>
    {:else if activeTerms.length === 0}
      <p class="acal-status">No academic terms available.</p>
    {:else}
      {#if timeline}
        <section class="acal-year" aria-label="{timelineHeading} timeline">
          <h2 class="acal-year__heading">{timelineHeading}</h2>
          <div class="acal-strip">
            {#each timeline.months as month (month.startPct)}
              <span class="acal-month" style="left: {month.startPct}%"
                >{month.label}</span
              >
            {/each}
            {#each timeline.segments as segment (segment.term.id)}
              <div
                class="acal-seg acal-seg--{segment.status}"
                style="left: {segment.startPct}%; width: {segment.widthPct}%"
                title="{segment.term.label}: {formatTermDateRange(
                  segment.window,
                )}"
              >
                <span class="acal-seg__label">{termChipLabel(segment.term)}</span>
              </div>
            {/each}
            {#if timeline.todayPct !== null}
              <div
                class="acal-today"
                style="left: {timeline.todayPct}%"
                aria-hidden="true"
              ></div>
            {/if}
          </div>
          <p class="acal-caption">Today: {todayLabel} (Asia/Manila)</p>
        </section>
      {/if}

      <section class="acal-terms" aria-label="Terms">
        {#each cards as card (card.term.id)}
          <article
            class="acal-card"
            class:acal-card--current={card.status === "in-session"}
          >
            <div class="acal-card__head">
              <h3 class="acal-card__label">{termFullLabel(card.term)}</h3>
              <span class="acal-badge acal-badge--{card.status}"
                >{STATUS_LABEL[card.status]}</span
              >
            </div>
            <p class="acal-card__meta">
              <span>CRS {card.term.id}</span>
              {#if card.window}
                <span>{formatTermDateRange(card.window)}</span>
              {/if}
              {#if card.term.classCount > 0}
                <span>{card.term.classCount} classes campus-wide</span>
              {/if}
            </p>
          </article>
        {/each}
      </section>
    {/if}
  </div>
</div>

<style>
  .acal-screen {
    z-index: 150;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem 1.25rem calc(1rem + env(safe-area-inset-bottom, 0px));
    background: hsl(0, 0%, 98%);
    flex: 1 1 auto;
    pointer-events: auto;
    overflow: hidden;
  }

  .acal-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .acal-back {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: hsl(5, 53%, 32%);
    cursor: pointer;
    border-radius: 0.5rem;
    padding: 0.25rem 0.5rem;
  }

  .acal-back:hover {
    background: hsl(5, 30%, 94%);
  }

  .acal-back:focus-visible {
    outline: 2px solid hsl(5, 53%, 32%);
  }

  .acal-title {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 800;
    color: hsl(0, 0%, 12%);
  }

  .acal-note {
    margin: 0;
    font-size: 0.8125rem;
    color: hsl(0, 0%, 40%);
    max-width: 52rem;
  }

  .acal-body {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding-bottom: 1rem;
  }

  .acal-status {
    margin: 0;
    font-size: 0.875rem;
    color: hsl(0, 0%, 40%);
  }

  .acal-year {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 52rem;
  }

  .acal-year__heading {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 700;
    color: hsl(0, 0%, 20%);
  }

  .acal-strip {
    position: relative;
    height: 4rem;
    border: 1px solid hsl(0, 0%, 88%);
    border-radius: 0.625rem;
    background: white;
  }

  .acal-month {
    position: absolute;
    top: 0.25rem;
    padding-left: 0.1875rem;
    border-left: 1px solid hsl(0, 0%, 90%);
    height: calc(100% - 0.5rem);
    font-size: 0.5625rem;
    font-weight: 600;
    color: hsl(0, 0%, 55%);
    line-height: 1;
    pointer-events: none;
  }

  .acal-seg {
    position: absolute;
    bottom: 0.375rem;
    height: 1.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.375rem;
    overflow: hidden;
  }

  .acal-seg--past {
    background: hsl(0, 0%, 90%);
    color: hsl(0, 0%, 35%);
  }

  .acal-seg--upcoming {
    background: hsl(5, 30%, 92%);
    color: hsl(5, 40%, 30%);
  }

  .acal-seg--in-session {
    background: hsl(5, 53%, 32%);
    color: white;
  }

  .acal-seg__label {
    font-size: 0.625rem;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0 0.25rem;
  }

  .acal-today {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: hsl(210, 80%, 45%);
  }

  .acal-caption {
    margin: 0;
    font-size: 0.6875rem;
    font-weight: 600;
    color: hsl(210, 60%, 35%);
  }

  .acal-terms {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 52rem;
  }

  .acal-card {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.625rem 0.75rem;
    border: 1px solid hsl(0, 0%, 88%);
    border-radius: 0.625rem;
    background: white;
  }

  .acal-card--current {
    border-color: hsl(5, 53%, 32%);
    background: hsl(5, 53%, 98%);
  }

  .acal-card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .acal-card__label {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 700;
    color: hsl(0, 0%, 16%);
  }

  .acal-badge {
    flex: 0 0 auto;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.125rem 0.4375rem;
    border-radius: 999px;
  }

  .acal-badge--in-session {
    background: hsl(5, 53%, 32%);
    color: white;
  }

  .acal-badge--upcoming {
    background: hsl(5, 30%, 92%);
    color: hsl(5, 40%, 30%);
  }

  .acal-badge--past,
  .acal-badge--undated {
    background: hsl(0, 0%, 92%);
    color: hsl(0, 0%, 40%);
  }

  .acal-card__meta {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    font-size: 0.75rem;
    color: hsl(0, 0%, 42%);
  }

  @media (max-width: 48rem) {
    .acal-screen {
      padding: 0.75rem 0.75rem calc(0.75rem + env(safe-area-inset-bottom, 0px));
    }
  }

  /* 320px: keep every other month label so ticks don't collide. */
  @media (max-width: 30rem) {
    .acal-month:nth-child(even) {
      font-size: 0;
    }
  }
</style>
