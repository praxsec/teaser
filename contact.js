(() => {
  const contact = document.querySelector('#contact');
  const trigger = contact.querySelector('button');

  trigger.addEventListener('click', () => {
    // Discourage basic address harvesting; this is obfuscation, not secrecy.
    const address = atob('aW5mb0BwcmF4c2VjLmNvbQ==');
    const link = document.createElement('a');
    link.href = `mailto:${address}`;
    link.textContent = address;
    const hadFocus = document.activeElement === trigger;
    contact.replaceChildren(link);
    if (hadFocus) link.focus({ preventScroll: true });
  }, { once: true });

  trigger.hidden = false;
})();
