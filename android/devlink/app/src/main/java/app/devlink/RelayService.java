package app.devlink;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.IBinder;
import android.os.PowerManager;

/** Giữ chế độ Claude điều khiển sống khi tắt màn hình. */
public class RelayService extends Service {
    private PowerManager.WakeLock wl;

    @Override
    public IBinder onBind(Intent i) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel("relay", "Claude điều khiển", NotificationManager.IMPORTANCE_LOW));
        PendingIntent pi = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(this, "relay")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("MGU DevLink")
            .setContentText("Đang chờ lệnh từ Claude")
            .setContentIntent(pi)
            .setOngoing(true)
            .build();
        startForeground(7, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        if (wl == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "devlink:relay");
            wl.acquire();
        }
        Store st = new Store(this);
        if (intent == null && !st.relayOn()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        Relay.start(this, st);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        Relay.stop(this);
        if (wl != null && wl.isHeld()) wl.release();
        super.onDestroy();
    }
}
