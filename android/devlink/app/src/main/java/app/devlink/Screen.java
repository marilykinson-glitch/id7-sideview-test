package app.devlink;

import android.view.View;

abstract class Screen {
    final MainActivity a;

    Screen(MainActivity a) {
        this.a = a;
    }

    abstract View view();

    void onShow() {}
}
