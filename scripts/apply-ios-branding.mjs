import { execFile } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { promisify } from 'node:util'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apple = path.join(root, 'src-tauri/gen/apple')
const imageSet = path.join(apple, 'Assets.xcassets/LaunchLogo.imageset')
const appIconSet = path.join(apple, 'Assets.xcassets/AppIcon.appiconset')
const run = promisify(execFile)

await mkdir(imageSet, { recursive: true })
await copyFile(path.join(root, 'src-tauri/ios/LaunchScreen.storyboard'), path.join(apple, 'LaunchScreen.storyboard'))
await copyFile(path.join(root, 'src-tauri/icons/icon.png'), path.join(imageSet, 'LaunchLogo.png'))
await copyFile(path.join(root, 'src-tauri/ios/LaunchLogo.Contents.json'), path.join(imageSet, 'Contents.json'))

for (const file of await readdir(appIconSet)) {
  if (!file.endsWith('.png')) continue
  const png = path.join(appIconSet, file)
  const jpeg = `${png}.opaque.jpg`
  await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '100', png, '--out', jpeg])
  await run('sips', ['-s', 'format', 'png', jpeg, '--out', png])
  await rm(jpeg)
}

for (const file of ['project.yml', 'Podfile', 'jiucaihezi-app.xcodeproj/project.pbxproj']) {
  const target = path.join(apple, file)
  const source = await readFile(target, 'utf8')
  await writeFile(target, source.replaceAll('14.0', '15.0'))
}

console.log('[ios] applied launch screen and logo')
