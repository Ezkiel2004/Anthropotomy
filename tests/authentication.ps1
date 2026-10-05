param([string]$BrowserUrl = 'http://127.0.0.1:9225')
$ErrorActionPreference = 'Stop'
$target = Invoke-RestMethod "$BrowserUrl/json/new?about:blank" -Method Put
$socket = New-Object System.Net.WebSockets.ClientWebSocket
$null = $socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
$script:messageId = 0
function Send-CDP($method, $parameters) {
    $script:messageId++
    $id = $script:messageId
    $json = @{id=$id;method=$method;params=$parameters} | ConvertTo-Json -Depth 40 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $null = $socket.SendAsync([ArraySegment[byte]]::new($bytes), [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    do {
        $stream = New-Object IO.MemoryStream
        do {
            $buffer = New-Object byte[] 65536
            $received = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
            $stream.Write($buffer, 0, $received.Count)
        } while (!$received.EndOfMessage)
        $message = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
        $stream.Dispose()
    } while ($message.id -ne $id)
    if ($message.error) { throw ($message.error | ConvertTo-Json) }
    return $message.result
}
function Eval-JS([string]$expression) {
    $result = Send-CDP 'Runtime.evaluate' @{expression=$expression;awaitPromise=$true;returnByValue=$true}
    if ($result.exceptionDetails) { throw ($result.exceptionDetails | ConvertTo-Json -Depth 10) }
    return $result.result.value
}
try {
    $null = Send-CDP 'Page.enable' @{}
    $null = Send-CDP 'Runtime.enable' @{}
    $null = Send-CDP 'Page.navigate' @{url='http://127.0.0.1:8091/login.html'}
    Start-Sleep -Milliseconds 800
    $credentials = Get-Content '.runtime/test-access.json' -Raw
    $setup = @'
(async()=>{
 const c = CREDENTIALS;
 const req = async(path,body,method='POST') => { const r=await fetch('/api/'+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,...await r.json()};};
 let n=0; const check=(condition,label)=>{if(!condition)throw Error(label);n++;};
 const fixture={full_name:'Auth Test Student',school_id:'AUTH-ID-2026',email:'auth@example.com',contact_no:'09171234567',grade_level:'Grade 10',section:'Auth Section',username:'auth-student',password:'StudyWell!2026',confirm_password:'StudyWell!2026',terms:true};
 check((await req('auth/register.php',fixture)).status===409,'Unconfigured school year blocked');
 check((await req('auth/login.php',c)).success,'Existing teacher login');
 check((await req('config.php',{academic_year:'2026-2027',school_name:'Anthropotomy Test School',grade_level:'Grade 10'},'PUT')).success,'Configure isolated school');
 await req('auth/logout.php',{});
 for(const [change,status,label] of [[{email:'invalid'},422,'Email validation'],[{terms:false},422,'Terms required'],[{confirm_password:'different'},422,'Password match'],[{password:'short',confirm_password:'short'},422,'Short password'],[{full_name:[]},422,'Malformed field'],[{contact_no:'hello'},422,'Phone validation'],[{grade_level:'Invalid'},422,'Grade validation']])check((await req('auth/register.php',{...fixture,...change})).status===status,label);
 check((await req('auth/register.php',{...fixture,role:'admin'})).status===201,'Registration succeeds');
 check((await req('auth/register.php',fixture)).status===409,'Duplicate blocked');
 check((await req('auth/login.php',{username:fixture.school_id,password:'wrong'})).status===401,'Wrong password blocked');
 const login=await req('auth/login.php',{username:fixture.school_id,password:fixture.password});
 check(login.success && login.data.role==='student','Student ID login and no role escalation');
 check(!('password_hash' in login.data),'No credential hash returned');
 await req('auth/logout.php',{});
 check((await req('auth/login.php',{username:fixture.username,password:fixture.password})).success,'Username login');
 await req('auth/logout.php',{});
 location.hash='register';switchView(false);
 document.getElementById('registerForm').requestSubmit();
 check(document.querySelectorAll('[aria-invalid=true]').length===10,'All required fields validated');
 const mapping={fullName:'full_name',studentId:'school_id',contactNo:'contact_no',email:'email',gradeLevel:'grade_level',section:'section',regUsername:'username',regPassword:'password',confirmPassword:'confirm_password'};
 for(const [id,key] of Object.entries(mapping))document.getElementById(id).value=fixture[key];
 document.getElementById('terms').checked=true;
 check(validate(document.getElementById('registerForm')),'Valid form accepted');
 document.querySelector('[data-password=regPassword]').click();
 check(document.getElementById('regPassword').type==='text','Password visibility');
 document.querySelector('[data-password=regPassword]').click();updateStrength();
 check(document.getElementById('passwordStrength').value===4,'Strength indicator');
 document.getElementById('termsLink').click();check(document.getElementById('termsModal').open,'Terms opens');document.getElementById('termsModal').close();
 document.getElementById('regUsername').value='auth-browser';document.getElementById('studentId').value='AUTH-BROWSER';
 await handleRegister({preventDefault(){}});
 check(!document.getElementById('loginView').hidden && !document.getElementById('loginSuccess').hidden,'Registration switches to success login');
 document.getElementById('forgotLink').click();check(document.getElementById('forgotModal').open,'Recovery dialog opens');document.getElementById('forgotModal').close();
 return n;
})()
'@
    $count = Eval-JS $setup.Replace('CREDENTIALS', $credentials)
    Write-Output "Passed $count authentication and form checks."
    foreach ($width in @(1440,768,390,320)) {
        $null = Send-CDP 'Emulation.setDeviceMetricsOverride' @{width=$width;height=1000;deviceScaleFactor=1;mobile=($width -lt 650)}
        foreach ($view in @('login','register')) {
            $null = Eval-JS "location.hash='$view';switchView(false);"
            if (!(Eval-JS 'document.documentElement.scrollWidth <= innerWidth')) { throw "$view overflows at $width px" }
            if ($width -eq 1440 -or $width -eq 390) {
                $shot = Send-CDP 'Page.captureScreenshot' @{format='png';captureBeyondViewport=$true}
                [IO.File]::WriteAllBytes((Join-Path (Get-Location) ".runtime/auth-$view-$width.png"), [Convert]::FromBase64String($shot.data))
            }
        }
    }
    Write-Output 'Passed responsive overflow checks at 1440, 768, 390 and 320 pixels.'
    $null = Eval-JS "location.hash='login';switchView(false);document.getElementById('username').value='auth-browser';document.getElementById('password').value='StudyWell!2026';handleLogin();"
    Start-Sleep -Milliseconds 1000
    if ((Eval-JS 'location.pathname') -ne '/student/dashboard.html') { throw 'Student redirect failed' }
    Write-Output 'Passed real student dashboard redirect.'
} finally {
    $socket.Dispose()
    Invoke-RestMethod "$BrowserUrl/json/close/$($target.id)" | Out-Null
}
