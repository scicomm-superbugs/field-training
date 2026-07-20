Write-Host "1. Building the production bundle..." -ForegroundColor Green
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
npm.cmd run build

Write-Host "2. Preparing the build directory..." -ForegroundColor Green
cd dist
C:\Users\amage\PortableGit\cmd\git.exe init
C:\Users\amage\PortableGit\cmd\git.exe add .
C:\Users\amage\PortableGit\cmd\git.exe commit -m "Deploy static website to GitHub Pages"

Write-Host "3. Pushing build to gh-pages branch on GitHub..." -ForegroundColor Green
C:\Users\amage\PortableGit\cmd\git.exe push -f https://github.com/scicomm-superbugs/field-training main:gh-pages

Write-Host "4. Deployment completed successfully!" -ForegroundColor Green
