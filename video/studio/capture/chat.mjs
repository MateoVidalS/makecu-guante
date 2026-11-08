// Replay only the captured production SSE events through the app's fetch reader.
// UI components, record/chart requests, and show_chart navigation remain untouched.
export async function prepareChat(page, response) {
  if (response.events.at(-1)?.type !== 'done' || !response.events.some(e => e.name === 'compare') || !response.events.some(e => e.name === 'show_chart')) {
    throw new Error('Chat capture needs a completed real compare/chart response');
  }
  await page.evaluate(question => {
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      if (input !== '/api/chat') return original(input, options);
      const messages = JSON.parse(options.body).messages;
      if (messages.length !== 1 || messages[0].text !== question || window.captureChatStarted) throw new Error('Unexpected chat replay request');
      window.captureChatStarted = true;
      const body = new ReadableStream({ start(controller) {
        window.captureChatEvent = event => {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
          if (event.type === 'done') controller.close();
        };
      } });
      return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
    };
  }, response.question);
  await page.getByRole('button', { name: 'Ask about this patient', exact: true }).click();
  await page.clock.runFor(500);
  // Keep the chart's actual pose filter on opening, matching the compared metric.
  await page.locator('.report-details').evaluate(node => { node.open = true; });
  await page.clock.runFor(100);
  await page.getByLabel('Pose', { exact: true }).selectOption('open');
  await page.waitForLoadState('networkidle');
  await page.clock.runFor(100);
  await page.evaluate(() => scrollTo(0, 0));
}

export async function chatFrame(page, clip, frame, response, event, click) {
  const panel = page.locator('.doctor-chat-panel');
  const input = panel.locator('textarea');
  if (frame === 0) await event(clip, page, frame, 'focus', 'focus:chat-panel', panel);
  if (frame === 12) {
    await click(clip, page, frame, input, 'chat-input');
    await event(clip, page, frame, 'focus', 'focus:chat-input', input);
  }
  // Smooth acceleration/deceleration; each character still enters through the keyboard.
  if (frame >= 18 && frame <= 150) {
    const t = (frame - 18) / 132;
    const progress = t * t * (3 - 2 * t);
    const count = Math.floor(response.question.length * progress);
    const current = await input.inputValue();
    if (count > current.length) await input.pressSequentially(response.question.slice(current.length, count));
  }
  if (frame === 156) {
    await click(clip, page, frame, panel.getByRole('button', { name: 'Send', exact: true }), 'Send chat question');
    if (!await page.evaluate(() => window.captureChatStarted)) throw new Error('Chat stream did not start');
  }
  // Preserve every event and its order. Hold each real tool chip for review.
  const frames = [168, 195, 224, 244, 264];
  for (const [index, at] of frames.entries()) if (frame === at) {
    const value = response.events[index];
    if (!value) continue;
    await page.evaluate(value => window.captureChatEvent(value), value);
    await page.clock.runFor(34);
    if (value.type === 'tool') await event(clip, page, frame, 'focus', `focus:tool:${value.name}`, panel.locator('.doctor-chat-status'));
  }
  if (response.events.length !== frames.length) throw new Error('Update shot pacing for changed cached event count');
  // Frame the real chart below the fixed report header after show_chart scrolls to it.
  if (frame === 215) await page.evaluate(() => { window.captureChartScroll = scrollY; });
  if (frame >= 215 && frame <= 238) {
    const t = (frame - 215) / 23;
    await page.evaluate(p => scrollTo(0, window.captureChartScroll - 96 * p), t * t * (3 - 2 * t));
  }
  if (frame === 240 || frame === 280) {
    await event(clip, page, frame, 'focus', 'focus:chat-chart', page.locator('[data-chat-section="range"]'));
  }
  if (frame === 280) {
    const answer = panel.locator('.doctor-chat-message-model');
    const expected = response.events.filter(e => e.type === 'delta').map(e => e.text).join('');
    if (!(await answer.innerText()).includes(expected)) throw new Error('Recorded answer differs from the real cached response');
    await event(clip, page, frame, 'focus', 'focus:chat-answer', answer);
    await event(clip, page, frame, 'focus', 'focus:chat-panel', panel);
    await event(clip, page, frame, 'focus', 'focus:chart-chip', panel.getByRole('button', { name: 'Active range', exact: true }));
  }
}
