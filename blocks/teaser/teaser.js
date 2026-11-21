export default function decorate(block) {
  const rows = [...block.children];

  // Get the image and text content
  const imageRow = rows[0];
  const contentRow = rows[1];

  // Add classes for styling
  imageRow.classList.add('teaser-image');
  contentRow.classList.add('teaser-content');
}
