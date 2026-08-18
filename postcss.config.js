import cssDeclarationSorter from 'css-declaration-sorter'

export default {
  plugins: [cssDeclarationSorter({ order: 'alphabetical' })],
}
